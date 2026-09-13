"""Export the original vector artwork for the design handoff, not the live app."""
from pathlib import Path
from PIL import Image, ImageDraw
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets'
(OUT / 'icons').mkdir(parents=True, exist_ok=True)
(OUT / 'brand').mkdir(exist_ok=True)
(OUT / 'illustrations').mkdir(exist_ok=True)
ICONS = {
 'moon':'<path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.7 8.7 0 1 0 10.7 10.7Z"/>',
 'toilet':'<path d="M5 4h5v8H5zM5 12h15c0 4-3 6-7 6H9c-2 0-4-2-4-6ZM10 18v3h6l-1-3M13 9h7"/>',
 'carry':'<circle cx="9" cy="5" r="2"/><path d="M5 21v-7c0-3 1-5 4-5l4 5h6M9 14v7M13 7l2 2 4-2M15 9l-2 4"/><circle cx="19" cy="4" r="1.5"/>',
 'water':'<path d="M6 5h12l-1.5 15h-9ZM7 11c3-2 6 2 10 0M10 2h4"/>',
 'wake':'<path d="M6 14a6 6 0 0 1 12 0M3 14h18M5 5l2 2M12 2v3M19 5l-2 2M6 18h12M9 21h6"/>',
 'drop':'<path d="M12 3c-2 4-7 8-7 12a7 7 0 0 0 14 0c0-4-5-8-7-12ZM9 16c0 1.5 1 2 2 2"/>',
 'history':'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4M16 3v4M4 11h16M8 15h2M14 15h2M8 18h2"/>',
 'more':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 'check':'<path d="m6 12 4 4 8-8"/>',
 'chevron-right':'<path d="m9 5 7 7-7 7"/>',
 'back':'<path d="m14 5-7 7 7 7"/>',
 'undo':'<path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 0 12"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'minus':'<path d="M5 12h14"/>',
 'close':'<path d="m6 6 12 12M18 6 6 18"/>',
 'edit':'<path d="m4 16-1 5 5-1L20 8l-4-4L4 16ZM14 6l4 4"/>',
 'delete':'<path d="M4 7h16M9 3h6l1 4M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
 'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 'bed':'<path d="M3 6v15M21 12v9M3 17h18M3 12h18M7 12V8h5v4M12 9h5c3 0 4 1 4 3"/>',
 'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M19 5l-1 1M6 18l-1 1"/>',
 'note':'<path d="M5 3h10l4 4v14H5ZM15 3v5h4M8 12h8M8 16h6"/>',
 'patterns':'<path d="M4 3v17h17M8 16v-4M13 16V7M18 16v-7"/>',
 'routine':'<path d="M5 7h13l-3-3M19 17H6l3 3M19 7v4M5 17v-4"/>',
 'backup':'<path d="M5 16v5h14v-5M12 16V3M7 8l5-5 5 5"/>',
 'restore':'<path d="M5 16v5h14v-5M12 3v13M7 11l5 5 5-5"/>',
 'share':'<path d="M8 9H4v12h16V9h-4M12 15V2M8 6l4-4 4 4"/>',
 'print':'<path d="M7 8V3h10v5M6 17H3V9h18v8h-3M7 14h10v7H7ZM17 11h1"/>',
 'shield':'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3ZM8 12l3 3 5-6"/>',
 'info':'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.1"/>',
 'alert':'<path d="m12 3 10 18H2L12 3ZM12 9v5M12 17v.1"/>',
 'phone':'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M10 19h4"/>',
 'offline':'<path d="m3 3 18 18M5 8a13 13 0 0 0-3 2M8 12a7 7 0 0 0-2 2M10 17l2 2 2-2M10 6a13 13 0 0 1 12 4M14 11a7 7 0 0 1 4 3"/>',
 'appearance':'<circle cx="12" cy="12" r="9"/><path d="M12 3v18M12 7a5 5 0 0 1 0 10"/>',
 'reminder':'<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3ZM10 21h4M12 2v2"/>',
 'filter':'<path d="M4 6h16M7 12h10M10 18h4"/>',
 'empty':'<path d="M4 5h7l2 2h7v14H4ZM8 13h8M8 17h5"/>',
 'review':'<circle cx="12" cy="12" r="9"/><path d="M12 6v7M12 17v.1"/>',
 'dry':'<circle cx="12" cy="12" r="7"/>',
 'missing':'<path stroke-dasharray="2 4" d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0"/>',
 'complete':'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>',
}
prefix='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" color="#B1BDD1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'
for name, shape in ICONS.items():
    (OUT/'icons'/f'{name}.svg').write_text(prefix+shape+'</svg>', encoding='utf-8')
symbols=''.join(f'<symbol id="{name}" viewBox="0 0 24 24">{shape}</symbol>' for name,shape in ICONS.items())
(OUT/'icons.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"><defs>'+symbols+'</defs></svg>',encoding='utf-8')

mark='<circle cx="492" cy="432" r="210" fill="#D6C9AC"/><circle cx="592" cy="322" r="210" fill="#10151E"/><path d="M252 677 Q492 823 752 657" fill="none" stroke="#788AA8" stroke-width="40" stroke-linecap="round"/>'
master='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#10151E"/>'+mark+'</svg>'
(OUT/'brand'/'app-icon-master.svg').write_text(master,encoding='utf-8')
mask='<defs><mask id="crescent"><rect width="1024" height="1024" fill="black"/><circle cx="492" cy="432" r="210" fill="white"/><circle cx="592" cy="322" r="210" fill="black"/></mask></defs>'
transparent=mask+'<rect width="1024" height="1024" fill="#D6C9AC" mask="url(#crescent)"/><path d="M252 677 Q492 823 752 657" fill="none" stroke="#788AA8" stroke-width="40" stroke-linecap="round"/>'
(OUT/'brand'/'mark.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">'+transparent+'</svg>',encoding='utf-8')
(OUT/'brand'/'wordmark.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="280" height="64" viewBox="0 0 280 64"><g transform="translate(-5,-5) scale(.074)">'+transparent+'</g><text x="68" y="45" fill="#D6C9AC" font-size="42" font-family="Segoe UI,Arial,sans-serif" letter-spacing="-1.6">peelog</text></svg>',encoding='utf-8')

def render(size):
    scale=4
    im=Image.new('RGB',(1024*scale,1024*scale),'#10151E')
    d=ImageDraw.Draw(im)
    def circle(cx,cy,r,color):d.ellipse(tuple(v*scale for v in (cx-r,cy-r,cx+r,cy+r)),fill=color)
    circle(492,432,210,'#D6C9AC');circle(592,322,210,'#10151E')
    pts=[]
    for i in range(201):
        t=i/200; x=(1-t)**2*252+2*(1-t)*t*492+t*t*752;y=(1-t)**2*677+2*(1-t)*t*823+t*t*657
        pts.append((round(x*scale),round(y*scale)))
    d.line(pts,fill='#788AA8',width=40*scale)
    circle(252,677,20,'#788AA8');circle(752,657,20,'#788AA8')
    return im.resize((size,size),Image.Resampling.LANCZOS)
for name,size in [('app-icon-1024',1024),('icon-512',512),('icon-maskable-512',512),('icon-192',192),('apple-touch-icon-180',180),('favicon-32',32)]:render(size).save(OUT/'brand'/f'{name}.png')
tokens={
 'name':'Quiet company','version':1,
 'color':{'background':'#10151E','surface':'#1B2432','surfaceRaised':'#252F40','border':'#687B97','text':'#E0DFD8','secondary':'#A4ADBB','accent':'#D6C9AC','wet':'#D0A893','wetSurface':'#2B2424','saved':'#ADBFAD','error':'#E7AE9D','focus':'#D6C9AC'},
 'type':{'headingFamily':'Georgia, serif','bodyFamily':'-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif','titlePx':36,'actionPx':18,'bodyPx':16,'secondaryPx':14,'metadataPx':12},
 'spacePx':[4,8,12,16,20,24,32], 'radiusPx':{'action':20,'field':12,'sheet':24},
 'minimumTargetPx':44,'icon':{'viewBox':'0 0 24 24','strokeWidth':1.5},'motion':{'feedbackMs':120,'decorativeAnimation':False}}
(ROOT/'tokens.json').write_text(json.dumps(tokens,indent=2)+'\n',encoding='utf-8')
(OUT/'icon-names.json').write_text(json.dumps(list(ICONS),indent=2)+'\n',encoding='utf-8')
print(f'Exported {len(ICONS)} icons, sprite, brand SVGs, six PNG sizes and design tokens.')

if __name__=='__main__':pass

