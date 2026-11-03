# 仕様書の状態を一括で変える（開発用）。使い方：python3 scripts/spec-status.py 001 完了 [AC番号をチェック: all|1,2,3]
import re, sys, glob
num, status = sys.argv[1], sys.argv[2]
acs = sys.argv[3] if len(sys.argv) > 3 else ''
path = glob.glob(f'docs/specs/{num}-*.md')[0]
s = open(path, encoding='utf-8').read()
s = re.sub(r'^- 状態：\S+$', f'- 状態：{status}', s, count=1, flags=re.M)
if acs:
    def tick(m):
        n = m.group(1)
        return f'- [x] AC{n}：' if acs == 'all' or n in acs.split(',') else m.group(0)
    s = re.sub(r'- \[ \] AC(\d+)：', tick, s)
if status == '完了':
    s = re.sub(r'(### タスク\n)((?:- \[[ x]\] .*\n)+)', lambda m: m.group(1) + m.group(2).replace('- [ ]', '- [x]'), s)
open(path, 'w', encoding='utf-8').write(s)
readme = 'docs/specs/README.md'
r = open(readme, encoding='utf-8').read()
r = re.sub(rf'^(\| {num} \|.*?\| )(ドラフト|合意済み|実装中|完了|見送り)( \|)', rf'\g<1>{status}\3', r, flags=re.M)
open(readme, 'w', encoding='utf-8').write(r)
print(path, status)
