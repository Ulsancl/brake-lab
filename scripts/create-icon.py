"""Create the original Brake Lab icon from simple geometric shapes."""
from pathlib import Path
from math import cos, sin, pi
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
target = root / 'desktop' / 'assets'
target.mkdir(parents=True, exist_ok=True)
scale = 3
image = Image.new('RGBA', (512*scale, 512*scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
def box(coords):
    return tuple(round(v*scale) for v in coords)
def ellipse(coords, fill, outline=None, width=1):
    draw.ellipse(box(coords), fill=fill, outline=outline, width=width*scale)

draw.rounded_rectangle(box((8,8,504,504)), radius=100*scale, fill='#14232d', outline='#456674', width=7*scale)
ellipse((64,64,448,448),'#9cabb4','#d6e1e5',8)
ellipse((91,91,421,421),'#c1ced4','#6b7c85',3)
for i in range(20):
    angle=i*2*pi/20
    x1,y1=256+136*cos(angle),256+136*sin(angle)
    x2,y2=256+151*cos(angle+.075),256+151*sin(angle+.075)
    draw.line(box((x1,y1,x2,y2)),fill='#556d78',width=9*scale)
ellipse((165,165,347,347),'#536b78','#e3ebed',5)
ellipse((207,207,305,305),'#13242e','#b8c9d1',5)
for i in range(5):
    angle=i*2*pi/5-pi/2
    x,y=256+67*cos(angle),256+67*sin(angle)
    ellipse((x-10,y-10,x+10,y+10),'#192c37','#d3e0e5',3)
draw.rounded_rectangle(box((335,112,453,355)),radius=28*scale,fill='#3bbaaa',outline='#9cead9',width=6*scale)
draw.rounded_rectangle(box((357,151,431,320)),radius=15*scale,fill='#18483f',outline='#74d4bf',width=4*scale)
for y in (166,288):
    ellipse((373,y,414,y+34),'#d3e1e5','#658e8e',4)
image=image.resize((512,512),Image.Resampling.LANCZOS)
image.save(target/'app.png')
image.save(target/'app.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
print(f'Brake Lab icon: {target / "app.ico"}')
