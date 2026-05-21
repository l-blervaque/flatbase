#!/usr/bin/env python3
"""
flatbase converter — Rails schema.rb

Usage:
  python3 rails_schema.py schema.rb
  python3 rails_schema.py commercial.rb sales.rb
  python3 rails_schema.py schema.rb -o tables.json
  cat schema.rb | python3 rails_schema.py -
"""
import re, json, sys, argparse
from datetime import date
from pathlib import Path

CONVERTER_NAME = 'rails_schema'
ACCEPTED_EXTENSIONS = {'.rb'}
AUDIT_COLUMNS = {'id', 'created_at', 'updated_at', 'created_by', 'updated_by'}

RAILS_TYPE_MAP = {
    'string': 'string', 'text': 'text', 'integer': 'integer', 'bigint': 'bigint',
    'float': 'float', 'decimal': 'decimal', 'boolean': 'boolean',
    'datetime': 'datetime', 'date': 'date', 'time': 'time', 'timestamp': 'timestamp',
    'binary': 'binary', 'jsonb': 'jsonb', 'json': 'json', 'uuid': 'uuid',
    'inet': 'inet', 'citext': 'citext',
}

# ── BOILERPLATE (logique commune à tous les convertisseurs) ────────────────────

def infer_domain(path):
    return 'main' if path == '-' else Path(path).stem.lower()

def build_output(tables_by_domain, enums=None):
    all_tables = []
    for domain, tables in tables_by_domain.items():
        for t in tables:
            all_tables.append({**t, 'domain': domain})
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
    p = argparse.ArgumentParser(description='Convert Rails schema.rb to flatbase JSON')
    p.add_argument('files', nargs='*', metavar='FILE',
                   help='Rails schema files (.rb) or - for stdin')
    p.add_argument('-o', '--out', metavar='FILE', help='Write output to FILE')
    return p.parse_args()

# ── PARSER (Rails schema.rb) ──────────────────────────────────────────────────

def _singularize(name):
    if name.endswith('ies'):
        return name[:-3] + 'y'
    if re.search(r'(s|x|z|sh|ch)es$', name):
        return name[:-2]
    if name.endswith('s'):
        return name[:-1]
    return name

def infer_table_type(columns):
    pk_cols = [c for c in columns if c.get('pk')]
    non_audit = [c for c in columns if c['name'] not in AUDIT_COLUMNS and not c.get('pk')]
    if len(pk_cols) == 2 and all('fk' in c for c in pk_cols) and len(non_audit) == 0:
        return 'pivot'
    if len(pk_cols) == 1 and 'fk' in pk_cols[0]:
        return 'extension'
    return 'entity'

def parse_rails_schema(content):
    tables = []

    for m in re.finditer(
            r'create_table\s+"(\w+)"(.*?)do\s*\|t\|(.*?)end\b',
            content, re.DOTALL | re.IGNORECASE):
        table_name = m.group(1)
        options = m.group(2)
        body = m.group(3)

        columns = []
        no_id = 'id: false' in options
        if not no_id:
            pk_type = 'uuid' if 'id: :uuid' in options else 'bigint'
            columns.append({'name': 'id', 'type': pk_type, 'pk': True, 'nullable': False})

        for line in body.split('\n'):
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            m_ref = re.match(r't\.references\s+"(\w+)"(.*)?$', line)
            if m_ref:
                ref_name = m_ref.group(1)
                ref_opts = m_ref.group(2) or ''
                col = {'name': f'{ref_name}_id', 'type': 'bigint', 'fk': ref_name}
                if 'null: false' in ref_opts:
                    col['nullable'] = False
                else:
                    col['nullable'] = True
                columns.append(col)
                continue

            m_col = re.match(r't\.(\w+)\s+"(\w+)"(.*)?$', line)
            if not m_col:
                continue

            col_type = m_col.group(1)
            col_name = m_col.group(2)
            opts = m_col.group(3) or ''

            mapped = RAILS_TYPE_MAP.get(col_type, col_type)
            m_limit = re.search(r'limit:\s*(\d+)', opts)
            if m_limit and col_type == 'string':
                mapped = f'string({m_limit.group(1)})'

            col = {'name': col_name, 'type': mapped}
            if 'null: false' in opts:
                col['nullable'] = False
            else:
                col['nullable'] = True
            m_def = re.search(r'default:\s*([^,\n]+)', opts)
            if m_def:
                col['default'] = m_def.group(1).strip().strip('"\'')
            columns.append(col)

        tables.append({
            'id': table_name,
            'name': ' '.join(w.capitalize() for w in table_name.split('_')),
            'type': infer_table_type(columns),
            'columns': columns,
        })

    # Apply add_foreign_key statements
    for m in re.finditer(
            r'add_foreign_key\s+"(\w+)",\s+"(\w+)"'
            r'(?:.*?column:\s*"(\w+)")?',
            content, re.IGNORECASE):
        src_table = m.group(1)
        ref_table = m.group(2)
        col_name = m.group(3) if m.group(3) else f'{_singularize(ref_table)}_id'
        for table in tables:
            if table['id'] == src_table:
                for col in table['columns']:
                    if col['name'] == col_name and 'fk' not in col:
                        col['fk'] = ref_table

    return tables

def main():
    args = parse_args()
    files = args.files or ['-']
    for f in files:
        validate_extension(f)
    tables_by_domain = {}
    for f in files:
        domain = infer_domain(f)
        if domain in tables_by_domain:
            print(f'warning: duplicate domain {domain!r} from {f!r}, overwriting previous',
                  file=sys.stderr)
        tables_by_domain[domain] = parse_rails_schema(read_file(f))
    write_output(build_output(tables_by_domain), args.out)

if __name__ == '__main__':
    main()
