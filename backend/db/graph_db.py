from __future__ import annotations
# 'from __future__ import annotations' allows Python 3.9 to understand the
# `kuzu.Database | None` type hint syntax without a runtime error.
# Python 3.10+ supports this natively; the import makes it work on 3.9 too.

"""
db/graph_db.py — Kuzu embedded graph database layer.

What this file does:
    Stores decisions and their relationships as a graph, enabling queries like:
      - "Find all decisions made by Alice."
      - "Find all decisions that affect the 'budget' system."
      - "Find all decisions tagged 'health'."

Why a graph database?
    SQL is great for querying individual records, but poor at traversing
    relationships (e.g. "find all decisions two hops away from this person").
    A graph DB stores relationships as first-class objects, making these
    queries fast and natural. Kuzu is an embedded graph DB — no server
    process needed, just a file on disk.

Graph schema:
    Node types:
        Decision  — id (PK), title
        Person    — name (PK)
        System    — name (PK)
        Risk      — label (PK)
        Tag       — name (PK)

    Edge types (relationships):
        MADE_BY     Decision → Person  (owner of the decision)
        OPPOSED_BY  Decision → Person  (dissenter)
        AFFECTS     Decision → System  (related system or area)
        HAS_RISK    Decision → Risk    (accepted risk)
        HAS_TAG     Decision → Tag     (topic tag)
        RELATED_TO  Decision → Decision (for future use)

    Example graph path:
        (Decision "Switch to solar") -[MADE_BY]-> (Person "Dad")
        (Decision "Switch to solar") -[HAS_TAG]-> (Tag "energy")

Why Kuzu (not Neo4j)?
    Kuzu is fully embedded (like SQLite for graphs) — no server to run or
    pay for. It's fast for read-heavy analytical queries on a small dataset.
    Neo4j would be overkill for a family app.

IMPORTANT — Kuzu 0.9+ file-based storage:
    Kuzu 0.9+ stores the entire database as a SINGLE FILE (not a directory).
    Never pre-create the GRAPH_PATH with os.makedirs. If a directory already
    exists at that path, Kuzu will crash. The directory containing the file
    (e.g. ./data/) must exist, but the file itself must not.

IMPORTANT — CREATE vs MERGE for nodes:
    Kuzu 0.11 does not support parameterised property values in MERGE patterns.
    A query like `MERGE (:Person {name: $n})` fails with a parse error.
    Instead, we use `CREATE` wrapped in try/except to simulate an upsert:
    - Try to CREATE the node.
    - If it fails (because the primary key already exists), silently ignore it.
    This achieves the same result as MERGE without triggering Kuzu's limitation.
"""

import os
import kuzu
from config import settings


# ---------------------------------------------------------------------------
# Module-level singletons — the database and connection objects
# ---------------------------------------------------------------------------
# We reuse a single database + connection throughout the process lifetime.
# Creating a new connection per request would be wasteful and unnecessary
# for an embedded database that is only accessed by one process.

_db: kuzu.Database | None = None
_conn: kuzu.Connection | None = None


def get_connection() -> kuzu.Connection:
    """
    Return the shared Kuzu connection, initialising it on first call.

    This is a lazy singleton — the database file is not opened until the
    first time a graph operation is actually needed.

    Returns:
        A kuzu.Connection ready for executing Cypher queries.

    Side effects (on first call only):
        - Creates the parent directory (e.g. ./data/) if it doesn't exist.
        - Opens (or creates) the Kuzu database file at settings.GRAPH_PATH.
        - Calls _init_schema to create node/edge table types if needed.
    """
    global _db, _conn
    if _conn is None:
        # Create the PARENT DIRECTORY (e.g. ./data/) if it doesn't exist.
        # We deliberately do NOT makedirs on GRAPH_PATH itself — Kuzu
        # expects to create that file, not find a directory there.
        os.makedirs(os.path.dirname(settings.GRAPH_PATH), exist_ok=True)

        # Open (or create) the database file. Kuzu creates the file on first run.
        _db = kuzu.Database(settings.GRAPH_PATH)

        # A Connection is the object we use to run Cypher queries.
        _conn = kuzu.Connection(_db)

        # Set up node and edge table types if this is a fresh database.
        _init_schema(_conn)

    return _conn


def _init_schema(conn: kuzu.Connection):
    """
    Create the graph schema (node and edge table types) if they don't exist.

    Kuzu uses 'CREATE NODE TABLE IF NOT EXISTS' similar to SQL's
    'CREATE TABLE IF NOT EXISTS', so this is safe to call every startup.

    Parameters:
        conn: An open Kuzu connection.

    Node tables define what kinds of nodes exist and their properties.
    Relationship tables define what kinds of edges exist and which node
    types they connect.

    Errors are silently swallowed — Kuzu may raise if a table already
    exists (despite IF NOT EXISTS in older versions), so we protect each
    statement individually.
    """
    statements = [
        # Node tables — each has a primary key that must be unique.
        "CREATE NODE TABLE IF NOT EXISTS Decision(id STRING, title STRING, PRIMARY KEY(id))",
        "CREATE NODE TABLE IF NOT EXISTS Person(name STRING, PRIMARY KEY(name))",
        "CREATE NODE TABLE IF NOT EXISTS System(name STRING, PRIMARY KEY(name))",
        "CREATE NODE TABLE IF NOT EXISTS Risk(label STRING, PRIMARY KEY(label))",
        "CREATE NODE TABLE IF NOT EXISTS Tag(name STRING, PRIMARY KEY(name))",

        # Relationship tables — FROM/TO define which node types they connect.
        "CREATE REL TABLE IF NOT EXISTS MADE_BY(FROM Decision TO Person)",
        "CREATE REL TABLE IF NOT EXISTS OPPOSED_BY(FROM Decision TO Person)",
        "CREATE REL TABLE IF NOT EXISTS AFFECTS(FROM Decision TO System)",
        "CREATE REL TABLE IF NOT EXISTS HAS_RISK(FROM Decision TO Risk)",
        "CREATE REL TABLE IF NOT EXISTS HAS_TAG(FROM Decision TO Tag)",
        "CREATE REL TABLE IF NOT EXISTS RELATED_TO(FROM Decision TO Decision)",
    ]

    for stmt in statements:
        try:
            conn.execute(stmt)
        except Exception:
            # Some Kuzu versions raise even with IF NOT EXISTS if the table
            # already exists. We ignore these errors — the schema is already set.
            pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _create_node(conn: kuzu.Connection, label: str, prop: str, value: str):
    """
    Attempt to create a node, silently ignoring duplicate primary key errors.

    This implements a 'create if not exists' pattern for nodes. Kuzu 0.11
    does not support parameterised properties in MERGE (e.g. MERGE (:Person {name: $n})),
    so we use CREATE + ignore-on-failure as the workaround.

    Parameters:
        conn:  The Kuzu connection.
        label: The node table name (e.g. "Person", "Tag").
        prop:  The primary key property name (e.g. "name", "label").
        value: The value for that property (e.g. "Alice", "health").
    """
    try:
        conn.execute(f"CREATE (:{label} {{{prop}: $v}})", {"v": value})
    except Exception:
        # A primary key violation means the node already exists — that's fine.
        pass


def _merge_rel(conn: kuzu.Connection, cypher: str, params: dict):
    """
    Execute a Cypher MERGE statement to create a relationship if it doesn't
    already exist, silently ignoring any errors.

    Using MERGE (not CREATE) for relationships is safe — Kuzu supports
    parameterised values in MERGE when the properties are on the matched
    nodes, not on the relationship being created.

    Parameters:
        conn:   The Kuzu connection.
        cypher: A Cypher MERGE query string.
        params: A dict of parameter values for the query.
    """
    try:
        conn.execute(cypher, params)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_decision_to_graph(decision_id: str, title: str, data: dict):
    """
    Add a decision and all its related nodes/edges to the graph.

    Called after a new decision is saved to SQLite, this function creates:
    - A Decision node.
    - Person nodes for each owner and dissenter.
    - System nodes for each related system.
    - Risk nodes for each accepted risk.
    - Tag nodes for each tag.
    - Edges connecting the Decision node to all the above.

    Parameters:
        decision_id: The UUID of the decision (must already exist in SQLite).
        title:       The decision's short title.
        data:        The full extracted decision dict (owners, tags, etc.).

    Design note — Decision node upsert:
        We try CREATE first. If that fails (decision already exists, e.g. on
        a re-ingest), we UPDATE the title with MATCH + SET instead.
        This gives us full upsert behaviour without MERGE.
    """
    conn = get_connection()

    # --- Upsert the Decision node ---
    # Try to create it; if the primary key already exists, update the title.
    try:
        conn.execute("CREATE (:Decision {id: $id, title: $title})", {"id": decision_id, "title": title})
    except Exception:
        # Node already exists — update its title in case it changed.
        try:
            conn.execute("MATCH (d:Decision {id: $id}) SET d.title = $title", {"id": decision_id, "title": title})
        except Exception:
            pass

    # --- Owners (MADE_BY edges) ---
    # Each person named as a decision owner gets a Person node and a MADE_BY edge.
    for person in data.get("owners", []):
        person = person.strip()
        if not person:
            continue  # Skip empty strings from the extraction
        _create_node(conn, "Person", "name", person)
        _merge_rel(conn,
            "MATCH (d:Decision {id: $did}), (p:Person {name: $name}) MERGE (d)-[:MADE_BY]->(p)",
            {"did": decision_id, "name": person},
        )

    # --- Dissenters (OPPOSED_BY edges) ---
    for person in data.get("dissenters", []):
        person = person.strip()
        if not person:
            continue
        _create_node(conn, "Person", "name", person)
        _merge_rel(conn,
            "MATCH (d:Decision {id: $did}), (p:Person {name: $name}) MERGE (d)-[:OPPOSED_BY]->(p)",
            {"did": decision_id, "name": person},
        )

    # --- Related systems (AFFECTS edges) ---
    for system in data.get("related_systems", []):
        system = system.strip()
        if not system:
            continue
        _create_node(conn, "System", "name", system)
        _merge_rel(conn,
            "MATCH (d:Decision {id: $did}), (s:System {name: $name}) MERGE (d)-[:AFFECTS]->(s)",
            {"did": decision_id, "name": system},
        )

    # --- Accepted risks (HAS_RISK edges) ---
    for risk in data.get("risks_accepted", []):
        risk = risk.strip()
        if not risk:
            continue
        _create_node(conn, "Risk", "label", risk)
        _merge_rel(conn,
            "MATCH (d:Decision {id: $did}), (r:Risk {label: $label}) MERGE (d)-[:HAS_RISK]->(r)",
            {"did": decision_id, "label": risk},
        )

    # --- Tags (HAS_TAG edges) ---
    # Tags are normalised to lowercase so "Health" and "health" don't create
    # two separate Tag nodes.
    for tag in data.get("tags", []):
        tag = tag.strip().lower()
        if not tag:
            continue
        _create_node(conn, "Tag", "name", tag)
        _merge_rel(conn,
            "MATCH (d:Decision {id: $did}), (t:Tag {name: $name}) MERGE (d)-[:HAS_TAG]->(t)",
            {"did": decision_id, "name": tag},
        )


def search_graph(query: str) -> list[dict]:
    """
    Search the graph for decisions related to a given keyword.

    Runs five separate Cypher queries, each searching a different part of
    the graph (person names, system names, tags, risks, and decision titles).
    Results from all five are combined and deduplicated.

    Parameters:
        query: A search keyword (e.g. "Alice", "budget", "health").

    Returns:
        A list of dicts, each with:
            id         — the decision UUID
            title      — the decision's short title
            match_type — where the match was found ("person", "system", "tag",
                         "risk", or "title")

    Why five queries instead of one?
        Kuzu does not support a single full-text search across all node types
        in one query. Running separate targeted queries is explicit, readable,
        and easy to extend.

    The `seen` set prevents the same decision from appearing multiple times
    if it matches in more than one category (e.g. a tag AND a person name).
    """
    conn = get_connection()
    results = []

    # Each tuple contains one Cypher query string.
    # 'lower($q)' and 'CONTAINS' give us case-insensitive substring matching,
    # which is friendlier than requiring exact matches.
    queries = [
        (
            "MATCH (d:Decision)-[:MADE_BY|OPPOSED_BY]->(p:Person) "
            "WHERE lower(p.name) CONTAINS lower($q) "
            "RETURN DISTINCT d.id, d.title, 'person'",
        ),
        (
            "MATCH (d:Decision)-[:AFFECTS]->(s:System) "
            "WHERE lower(s.name) CONTAINS lower($q) "
            "RETURN DISTINCT d.id, d.title, 'system'",
        ),
        (
            "MATCH (d:Decision)-[:HAS_TAG]->(t:Tag) "
            "WHERE lower(t.name) CONTAINS lower($q) "
            "RETURN DISTINCT d.id, d.title, 'tag'",
        ),
        (
            "MATCH (d:Decision)-[:HAS_RISK]->(r:Risk) "
            "WHERE lower(r.label) CONTAINS lower($q) "
            "RETURN DISTINCT d.id, d.title, 'risk'",
        ),
        (
            "MATCH (d:Decision) "
            "WHERE lower(d.title) CONTAINS lower($q) "
            "RETURN DISTINCT d.id, d.title, 'title'",
        ),
    ]

    # Track which decision IDs we've already added to avoid duplicates.
    seen = set()

    for (cypher,) in queries:
        try:
            r = conn.execute(cypher, {"q": query})
            # Kuzu returns results via an iterator: has_next()/get_next().
            while r.has_next():
                row = r.get_next()
                # row[0] = decision id, row[1] = title, row[2] = match_type
                if row[0] not in seen:
                    seen.add(row[0])
                    results.append({"id": row[0], "title": row[1], "match_type": row[2]})
        except Exception:
            # If one query fails (e.g. the node table is empty), skip it and
            # continue with the rest rather than crashing the entire search.
            pass

    return results


def remove_decision_from_graph(decision_id: str):
    """
    Delete a decision node and ALL of its edges from the graph.

    'DETACH DELETE' is a Cypher command that removes the node AND any
    relationships connected to it in one step. Without DETACH, Kuzu would
    raise an error if the node still has edges.

    Parameters:
        decision_id: The UUID of the decision to remove.

    Note:
        Person, System, Risk, and Tag nodes are NOT deleted even if this was
        the only decision connected to them. That avoids accidentally breaking
        other queries. Orphaned nodes take negligible space.
    """
    conn = get_connection()
    try:
        conn.execute("MATCH (d:Decision {id: $id}) DETACH DELETE d", {"id": decision_id})
    except Exception:
        # If the node doesn't exist (e.g. already deleted), ignore the error.
        pass
