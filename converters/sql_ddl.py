#!/usr/bin/env python3
"""
flatbase converter — SQL DDL (PostgreSQL / MySQL / SQLite)

Usage:
  python3 sql_ddl.py schema.sql
  python3 sql_ddl.py commercial.sql sales.sql customer.sql
  python3 sql_ddl.py schema.sql -o tables.json
  cat schema.sql | python3 sql_ddl.py -

Output: flatbase JSON
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'sql_ddl'
ACCEPTED_EXTENSIONS = {'.sql'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            t['domain'] = domain
            all_tables.append(t)
    out = {'meta': {'source': CONVERTER_NAME, 'converted_at': date.today().isoformat()},
           'tables': all_tables}
    if enums:
        out['enums'] = enums
    return out

def validate_extension(path):
    if path == '-':
        print('warning: reading from stdin, skipping extension check', file=sys.stderr)
        return
    ext = Path(path).suffix.lower()
    if ext not in ACCEPTED_EXTENSIONS:
        print(f'error: expected {sorted(ACCEPTED_EXTENSIONS)}, got {ext!r} ({path})',
              file=sys.stderr)
        sys.exit(1)

def read_file(path):
    return sys.stdin.read() if path == '-' else Path(path).read_text(encoding='utf-8')

def write_output(data, outfile=None):
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if outfile:
        Path(outfile).write_text(text, encoding='utf-8')
    else:
        print(text)

def parse_args():
    p = argparse.ArgumentParser(description='Convert SQL DDL to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='SQL files (.sql) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (SQL DDL) ──────────────────────────────────────────────────────────

def strip_comments(sql):
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    return re.sub(r'--[^\n]*', '', sql)

def split_top_level(s):
    parts, depth, buf = [], 0, []
    for ch in s:
        if ch == '(':
            depth += 1; buf.append(ch)
        elif ch == ')':
            depth -= 1; buf.append(ch)
        elif ch == ',' and depth == 0:
            parts.append(''.join(buf).strip()); buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf).strip())
    return parts

def extract_body(block):
    start = block.index('(')
    depth = 0
    for i, ch in enumerate(block[start:], start):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return block[start+1:i]
    return block[start+1:]

def parse_column(item):
    if re.match(r'^\s*(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT'
                r'|INDEX|KEY|FULLTEXT|SPATIAL)\b', item, re.IGNORECASE):
        return None
    if re.search(r'\bGENERATED\s+ALWAYS\s+AS\b', item, re.IGNORECASE):
        m_name = re.match(r'^\s*[`"]?(\w+)[`"]?', item)
        if m_name:
            print(f'warning: generated column {m_name.group(1)!r} ignored', file=sys.stderr)
        return None
    m = re.match(r'^\s*[`"]?(\w+)[`"]?\s+([^\s,]+(?:\s*\([^)]*\))?)', item, re.IGNORECASE)
    if not m:
        return None
    name, col_type = m.group(1).lower(), m.group(2).strip()
    rest = item[m.end():]
    col = {'name': name, 'type': col_type}
    if re.search(r'\bNOT\s+NULL\b', rest, re.IGNORECASE):
        col['nullable'] = False
    else:
        col['nullable'] = True
    if re.search(r'\bPRIMARY\s+KEY\b', rest, re.IGNORECASE):
        col['pk'] = True
    if re.search(r'\bUNIQUE\b', rest, re.IGNORECASE):
        col['unique'] = True
    m_def = re.search(r"\bDEFAULT\s+'?([^',\s)]+)'?", rest, re.IGNORECASE)
    if m_def:
        col['default'] = m_def.group(1)
    m_ref = re.search(
        r'\bREFERENCES\s+(?:\w+\.)?[`"]?(\w+)[`"]?\s*(?:\((\w+)\))?'
        r'(?:\s*ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?',
        rest, re.IGNORECASE)
    if m_ref:
        ref_table = m_ref.group(1).lower()
        ref_col = m_ref.group(2).lower() if m_ref.group(2) else None
        on_delete = m_ref.group(3).lower().replace(' ', '_') if m_ref.group(3) else None
        if ref_col and ref_col != 'id':
            fk = {'table': ref_table, 'column': ref_col}
            if on_delete: fk['on_delete'] = on_delete
            col['fk'] = fk
        elif on_delete:
            col['fk'] = {'table': ref_table, 'on_delete': on_delete}
        else:
            col['fk'] = ref_table
    return col

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if (len(pk_cols) == 2
            and all('fk' in c for c in pk_cols)
            and len(non_audit) == 0):
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_create_table(block):
    m = re.match(
        r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\w+\.)?[`"]?(\w+)[`"]?\s*\(',
        block, re.IGNORECASE)
    if not m:
        return None
    table_name = m.group(1).lower()
    try:
        body = extract_body(block)
    except (ValueError, IndexError):
        print(f'warning: could not parse body for {table_name}', file=sys.stderr)
        return None
    items = split_top_level(body)
    columns, table_pk_cols, table_fk_map, table_unique_cols = [], [], {}, set()
    for item in items:
        item = item.strip()
        if not item:
            continue
        if re.match(r'(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(', item, re.IGNORECASE):
            m_pk = re.search(r'\(([^)]+)\)', item)
            if m_pk:
                table_pk_cols = [c.strip().strip('`"').lower()
                                 for c in m_pk.group(1).split(',')]
        elif re.match(r'(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY', item, re.IGNORECASE):
            m_fk = re.search(
                r'FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(?:\w+\.)?[`"]?(\w+)[`"]?'
                r'\s*(?:\(([^)]+)\))?'
                r'(?:\s*ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?',
                item, re.IGNORECASE)
            if m_fk:
                cols = [c.strip().strip('`"').lower() for c in m_fk.group(1).split(',')]
                ref_t = m_fk.group(2).lower()
                ref_c = m_fk.group(3).strip().lower() if m_fk.group(3) else 'id'
                od = m_fk.group(4).lower().replace(' ', '_') if m_fk.group(4) else None
                for cn in cols:
                    table_fk_map[cn] = (ref_t, ref_c, od)
        elif re.match(r'(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(', item, re.IGNORECASE):
            m_u = re.search(r'\(([^)]+)\)', item)
            if m_u:
                ucols = [c.strip().strip('`"').lower() for c in m_u.group(1).split(',')]
                if len(ucols) == 1:
                    table_unique_cols.add(ucols[0])
        elif re.match(r'^\s*CHECK\b', item, re.IGNORECASE):
            print(f'warning: {table_name}: CHECK constraint ignored', file=sys.stderr)
        elif not re.match(r'^\s*(INDEX|KEY)\b', item, re.IGNORECASE):
            col = parse_column(item)
            if col:
                columns.append(col)
    for col in columns:
        n = col['name']
        if n in table_pk_cols:
            col['pk'] = True
        if n in table_unique_cols:
            col['unique'] = True
        if n in table_fk_map and 'fk' not in col:
            ref_t, ref_c, od = table_fk_map[n]
            if ref_c != 'id':
                fk = {'table': ref_t, 'column': ref_c}
                if od: fk['on_delete'] = od
                col['fk'] = fk
            elif od:
                col['fk'] = {'table': ref_t, 'on_delete': od}
            else:
                col['fk'] = ref_t
    return {
        'id': table_name,
        'name': ' '.join(w.capitalize() for w in table_name.split('_')),
        'type': infer_table_type(columns),
        'columns': columns,
    }

def parse_enum_block(block):
    m = re.match(
        r'CREATE\s+TYPE\s+[`"]?(\w+)[`"]?\s+AS\s+ENUM\s*\(([^)]+)\)',
        block, re.IGNORECASE)
    if not m:
        return None
    values = [{'code': v.strip().strip("'\"")}
              for v in m.group(2).split(',')
              if v.strip().strip("'\"")]
    return {'id': m.group(1).lower(), 'values': values}

def parse_sql(content):
    content = strip_comments(content)
    tables, enums = [], []
    for m in re.finditer(r'CREATE\s+TABLE\s[^;]+;', content,
                         re.IGNORECASE | re.DOTALL):
        t = parse_create_table(m.group(0))
        if t:
            tables.append(t)
    for m in re.finditer(
            r'CREATE\s+TYPE\s+\w+\s+AS\s+ENUM\s*\([^)]+\)\s*;',
            content, re.IGNORECASE):
        e = parse_enum_block(m.group(0))
        if e:
            enums.append(e)
    return tables, enums

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)
    tables_by_domain, all_enums = {}, []
    for f in files:
        tables, enums = parse_sql(read_file(f))
        tables_by_domain[infer_domain(f)] = tables
        all_enums.extend(enums)
    write_output(build_output(tables_by_domain, all_enums or None), args.out)

if __name__ == '__main__':
    main()
