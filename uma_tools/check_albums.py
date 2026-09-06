import json
d=json.load(open(r'C:\Users\51673\AppData\Local\Temp\opencode\albums_check.json'))
print('OK count:', len(d))
print('first album:', d[0].get('name'))
