#!/usr/bin/env python3
"""
flatbase converter — DBML (dbdiagram.io)

Usage:
  python3 dbml.py schema.dbml
  python3 dbml.py commercial.dbml sales.dbml
  python3 dbml.py schema.dbml -o tables.json
  cat schema.dbml | python3 dbml.py -

Note: TableGroup blocks map to flatbase domains. When present, they override
the filename-based domain inference.
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'dbml'
ACCEPTED_EXTENSIONS = {'.dbml'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            all_tables.append({**t, 'domain': domain})  # non-mutating
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
    p = argparse.ArgumentParser(description='Convert DBML to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='DBML files (.dbml) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (DBML) ─────────────────────────────────────────────────────────────

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_dbml(content):
    tables = []
    enums = []
    table_groups = {}  # table_name -> group_name

    # TableGroup blocks
    for m in re.finditer(r'TableGroup\s+\w+\s*\{([^}]+)\}', content,
                         re.IGNORECASE | re.DOTALL):
        group_name_m = re.match(r'TableGroup\s+(\w+)', m.group(0), re.IGNORECASE)
        if not group_name_m:
            continue
        group_name = group_name_m.group(1).lower()
        for name in re.split(r'[\s,]+', m.group(1)):
            name = name.strip()
            if name and not name.startswith('//'):
                table_groups[name.lower()] = group_name

    # Enum blocks
    for m in re.finditer(r'[Ee]num\s+(\w+)\s*\{([^}]+)\}', content, re.DOTALL):
        values = []
        body = m.group(2)
        # Strip line comments first
        body = re.sub(r'//[^\n]*', '', body)
        # Strip note: ... lines
        body = re.sub(r'\bnote\b[^\n]*', '', body, flags=re.IGNORECASE)
        for token in re.split(r'[\s,]+', body):
            token = token.strip()
            if token and re.match(r'^\w+$', token):
                values.append({'code': token})
        if values:
            enums.append({'id': m.group(1).lower(), 'values': values})

    # Table blocks
    for m in re.finditer(r'[Tt]able\s+(\w+)(?:\s+\[.*?\])?\s*\{([^}]+)\}', content,
                         re.DOTALL):
        table_name = m.group(1).lower()
        body = m.group(2)
        columns = []

        for line in body.split('\n'):
            line = line.strip()
            if not line or line.startswith('//'):
                continue
            if re.match(r'^(indexes|note)\b', line, re.IGNORECASE):
                break

            m_col = re.match(r'^(\w+)\s+(\S+)(?:\s+\[([^\]]*)\])?', line)
            if not m_col:
                continue

            col_name = m_col.group(1)
            col_type = m_col.group(2)
            attrs_str = m_col.group(3) or ''
            attrs = [a.strip().lower() for a in attrs_str.split(',')]

            col = {'name': col_name, 'type': col_type}
            if 'pk' in attrs:
                col['pk'] = True
            if 'not null' in attrs:
                col['nullable'] = False
            if 'unique' in attrs:
                col['unique'] = True

            m_def = re.search(r"default:\s*['\"]?([^,'\"\]]+)['\"]?", attrs_str, re.IGNORECASE)
            if m_def:
                col['default'] = m_def.group(1).strip()

            m_ref = re.search(r'ref:\s*[<>-]\s*(\w+)\.(\w+)', attrs_str, re.IGNORECASE)
            if m_ref:
                ref_table = m_ref.group(1).lower()
                ref_col = m_ref.group(2).lower()
                col['fk'] = ref_table if ref_col == 'id' else {'table': ref_table, 'column': ref_col}

            columns.append(col)

        tables.append({
            'id': table_name,
            'name': ' '.join(w.capitalize() for w in table_name.split('_')),
            'type': infer_table_type(columns),
            'columns': columns,
        })

    # External Ref statements
    for m in re.finditer(
            r'^[Rr]ef(?:\s*\w+)?:\s*(\w+)\.(\w+)\s*[<>-]\s*(\w+)\.(\w+)',
            content, re.MULTILINE):
        src_table = m.group(1).lower()
        src_col = m.group(2).lower()
        ref_table = m.group(3).lower()
        ref_col = m.group(4).lower()
        for table in tables:
            if table['id'] == src_table:
                for col in table['columns']:
                    if col['name'] == src_col and 'fk' not in col:
                        col['fk'] = ref_table if ref_col == 'id' else {'table': ref_table, 'column': ref_col}

    return tables, enums, table_groups

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)

    all_tables, all_enums, all_groups = [], [], {}
    for f in files:
        tables, enums, groups = parse_dbml(read_file(f))
        default_domain = infer_domain(f)
        for t in tables:
            t['_default_domain'] = default_domain
        all_tables.extend(tables)
        all_enums.extend(enums)
        all_groups.update(groups)

    tables_by_domain = {}
    for t in all_tables:
        default = t.pop('_default_domain')
        domain = all_groups.get(t['id'], default)
        tables_by_domain.setdefault(domain, []).append(t)

    write_output(build_output(tables_by_domain, all_enums or None), args.out)

if __name__ == '__main__':
    main()
