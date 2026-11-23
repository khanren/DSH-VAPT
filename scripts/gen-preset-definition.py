#!/usr/bin/env python3
"""Generate definition.json for EVERY preset directory under presets/.

Each `presets/<id>/` with `agent.cordis.yml` + `preset.yml` gets a `definition.json`
(rows serialized for the DSH `agentPresets.register()` API; `!!js` becomes `{ __jsExpr }`).
Run after touching any preset YAML and commit the regenerated JSON.
"""
import json, pathlib, sys
import yaml

BASE = pathlib.Path(__file__).resolve().parent.parent / 'presets'

class Loader(yaml.SafeLoader):
    pass
Loader.add_constructor('tag:yaml.org,2002:js',
                       lambda loader, node: {"__jsExpr": loader.construct_scalar(node)})

def absolutize(rows, base):
    out = []
    for r in rows:
        r = dict(r)
        name = r.get('name') or ''
        if name.startswith('./') or name.startswith('../'):
            r['name'] = (base / name).resolve().as_uri()
        if r.get('group') is True and isinstance(r.get('config'), list):
            r['config'] = absolutize(r['config'], base)
        out.append(r)
    return out

count = 0
for d in sorted(BASE.iterdir()):
    if not d.is_dir():
        continue
    if not (d / 'agent.cordis.yml').exists() or not (d / 'preset.yml').exists():
        continue
    rows = yaml.load((d / 'agent.cordis.yml').read_text(), Loader=Loader)
    meta = yaml.load((d / 'preset.yml').read_text(), Loader=Loader)
    assert isinstance(rows, list) and all(isinstance(r, dict) and r.get('name') for r in rows), f'{d.name}: bad rows'
    assert isinstance(meta, dict) and meta.get('name'), f'{d.name}: preset.yml needs a name'
    definition = {
        'id': d.name,
        'name': meta['name'],
        'description': meta.get('description', ''),
        'order': meta.get('order', 20),
        'plugins': absolutize(rows, d),
    }
    (d / 'definition.json').write_text(
        json.dumps(definition, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"{d.name}: {len(definition['plugins'])} rows · order {definition['order']}")
    count += 1
print(f'{count} preset(s) generated')
