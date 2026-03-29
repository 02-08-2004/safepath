import os
import time
import logging
import psycopg2
from psycopg2.extras import execute_values
import osmnx as ox
from shapely import wkt
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

load_dotenv()
DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/safepath")

# Configure OSMnx for larger downloads
ox.settings.timeout = 180  # 3 minutes
ox.settings.use_cache = True

def import_to_db():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cur = conn.cursor()

    # Configure OSMnx for detailed safety intelligence
    ox.settings.useful_tags_way = [
        "bridge", "tunnel", "oneway", "lanes", "ref", "name",
        "highway", "maxspeed", "service", "access", "area",
        "landuse", "width", "est_width", "junction", "surface",
        "lit", "sidewalk", "bicycle"
    ]
    ox.settings.timeout = 300 # 5 minutes per query

    districts = [
        "Guntur, Andhra Pradesh, India",
        "NTR District, Andhra Pradesh, India",
        "Krishna, Andhra Pradesh, India",
        "Visakhapatnam, Andhra Pradesh, India",
        "Srikakulam, Andhra Pradesh, India",
        "Vizianagaram, Andhra Pradesh, India",
        "Parvathipuram Manyam, Andhra Pradesh, India",
        "Alluri Sitharama Raju, Andhra Pradesh, India",
        "Anakapalli, Andhra Pradesh, India",
        "Kakinada, Andhra Pradesh, India",
        "East Godavari, Andhra Pradesh, India",
        "Konaseema, Andhra Pradesh, India",
        "West Godavari, Andhra Pradesh, India",
        "Eluru, Andhra Pradesh, India",
        "Palnadu, Andhra Pradesh, India",
        "Bapatla, Andhra Pradesh, India",
        "Prakasam, Andhra Pradesh, India",
        "SPSR Nellore, Andhra Pradesh, India",
        "Tirupati, Andhra Pradesh, India",
        "Chittoor, Andhra Pradesh, India",
        "Annamayya, Andhra Pradesh, India",
        "YSR District, Andhra Pradesh, India",
        "Nandyal, Andhra Pradesh, India",
        "Kurnool, Andhra Pradesh, India",
        "Anantapur, Andhra Pradesh, India",
        "Sri Sathya Sai, Andhra Pradesh, India"
    ]

    # ── ROAD & PLACE IMPORT (optimized district loop) ──
    for idx, d_name in enumerate(districts):
        log.info(f"[{idx+1}/{len(districts)}] Processing {d_name}...")
        
        # 1. Skip check: If we have many nodes for this exact district already, we can skip it
        # This saves hours on re-runs
        try:
            cur.execute("SELECT COUNT(*) FROM road_edges WHERE name ILIKE %s", (f"%{d_name.split(',')[0]}%",))
            count = cur.fetchone()[0]
            if count > 5000:
                log.info(f"   ⏩ Skipping {d_name} (found {count} existing edges).")
                continue
        except: pass

        try:
            # 2. Download graph (Simplify=True for routing performance)
            G = ox.graph_from_place(d_name, network_type="drive", simplify=True)
            log.info(f"   -> Roads: {len(G.nodes)} nodes, {len(G.edges)} edges.")
            
            # 3. Bulk insert Nodes (Handle list-type osmid)
            node_data = []
            for node, data in G.nodes(data=True):
                oid = node[0] if isinstance(node, (list, tuple)) else node
                node_data.append((oid, data['x'], data['y'], f"POINT({data['x']} {data['y']})"))
            
            execute_values(cur,
                "INSERT INTO road_nodes (osmid, x, y, geom) VALUES %s ON CONFLICT (osmid) DO NOTHING",
                node_data, template="(%s, %s, %s, ST_GeomFromText(%s, 4326))"
            )

            # 4. Bulk insert Edges (Fix Connectivity: ensure nodes are ready)
            edge_data = []
            for u, v, k, data in G.edges(data=True, keys=True):
                oid = data.get('osmid')
                if isinstance(oid, list): oid = oid[0]
                
                geom_wkt = wkt.dumps(data['geometry']) if 'geometry' in data else f"LINESTRING({G.nodes[u]['x']} {G.nodes[u]['y']}, {G.nodes[v]['x']} {G.nodes[v]['y']})"
                
                edge_data.append((
                    u, v, k, oid, data.get('name'), data.get('highway'),
                    float(data.get('length', 0)), geom_wkt
                ))

            execute_values(cur,
                "INSERT INTO road_edges (u, v, key, osmid, name, highway, length, geom) VALUES %s ON CONFLICT DO NOTHING",
                edge_data, template="(%s, %s, %s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326))"
            )

            # 5. Extract urban places/amenities
            tags = {
                'place': ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter'], 
                'amenity': ['hospital', 'school', 'police', 'university', 'college']
            }
            try:
                gdf = ox.features_from_place(d_name, tags=tags)
                if gdf is not None and len(gdf) > 0:
                    location_data = []
                    for _, row in gdf.iterrows():
                        if row['geometry'].geom_type == 'Point' and row.get('name'):
                            p_type = row.get('place') or row.get('amenity') or "Place"
                            location_data.append((row['name'], p_type, wkt.dumps(row['geometry'])))

                    execute_values(cur, 
                        "INSERT INTO ap_locations (name, place_type, geom) VALUES %s ON CONFLICT DO NOTHING", 
                        location_data, template="(%s, %s, ST_GeomFromText(%s, 4326))"
                    )
                    log.info(f"   -> Ingested {len(location_data)} urban markers.")
            except Exception as e:
                log.warning(f"   ⚠️ Place extraction for {d_name} skipped: {e}")

            log.info(f"   ✅ {d_name} ingestion complete.")

        except Exception as e:
            log.error(f"   ❌ Failed {d_name}: {e}")
            continue

    conn.close()
    log.info("🚀 Full State Data Migration Finished.")

if __name__ == "__main__":
    import_to_db()
