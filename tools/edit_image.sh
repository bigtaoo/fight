#!/usr/bin/env bash
# usage: edit_image.sh <input image> <output png> <prompt file>
set -euo pipefail
source "$(dirname "$0")/mistral_failover.sh"
IN="$1"; OUT="$2"; PROMPT_FILE="$3"
# MISTRAL_KEY=L|M|N|J|K|H|D|F|G picks the workspace; each workspace has its own agent
case "${MISTRAL_KEY:-H}" in
  H) CONF="$HOME/.vibe/mistral_curl_keyH.conf"; AGENT="ag_01a13ad6e58d715a89c9eca37a915309" ;;
  F) CONF="$HOME/.vibe/mistral_curl_keyF.conf"; AGENT="ag_01a1118451b2770089c64623a33a22b1" ;;
  G) CONF="$HOME/.vibe/mistral_curl_keyG.conf"; AGENT="ag_01a11185f4e2775b84cff3c759d8a84f" ;;
  D) CONF="$HOME/.vibe/mistral_curl_keyD.conf"; AGENT="ag_01a1071339ed769f8a3e6ecb75bf26dd" ;;
  J) CONF="$HOME/.vibe/mistral_curl_keyJ.conf"; AGENT="ag_01a140145d3574a8afbbb4e0baf3a9dd" ;;
  K) CONF="$HOME/.vibe/mistral_curl_keyK.conf"; AGENT="ag_01a14015661e75a8ad3cb391ac2845ed" ;;
  L) CONF="$HOME/.vibe/mistral_curl_keyL.conf"; AGENT="ag_01a1540fa9987219b0bcdd68f3498adc" ;;
  M) CONF="$HOME/.vibe/mistral_curl_keyM.conf"; AGENT="ag_01a1540faac174cabeff2fe987bb57ba" ;;
  N) CONF="$HOME/.vibe/mistral_curl_keyN.conf"; AGENT="ag_01a1540fac1872dfa9a76d031b395f53" ;;
  *) echo "MISTRAL_KEY must be one of L, M, N, J, K, H, D, F or G" >&2; exit 2 ;;
esac
TMP="${TMPDIR:-/tmp}/mistral_edit_$$"; mkdir -p "$TMP"

curl -s --config "$CONF" https://api.mistral.ai/v1/files \
  -F purpose=image_generation -F "file=@$IN" > "$TMP/upload.json"
FID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).id)' "$TMP/upload.json")
curl -s --config "$CONF" "https://api.mistral.ai/v1/files/$FID/url?expiry=24" > "$TMP/url.json"
URL=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).url)' "$TMP/url.json")

node -e '
const fs=require("fs");
const [url,pf,agent,out]=process.argv.slice(1);
const p=fs.readFileSync(pf,"utf8");
const inputs=`Call the image_generation tool function edit_image with these exact arguments.\nimage_url: ${url}\nprompt: ${p}`;
fs.writeFileSync(out, JSON.stringify({agent_id:agent, inputs}));
' "$URL" "$PROMPT_FILE" "$AGENT" "$TMP/req.json"

curl -s --config "$CONF" https://api.mistral.ai/v1/conversations \
  -H "Content-Type: application/json" --data @"$TMP/req.json" > "$TMP/resp.json"

IMG=$(node -e '
const r=JSON.parse(require("fs").readFileSync(process.argv[1]));
if(!r.outputs){console.error(JSON.stringify(r));process.exit(1)}
for(const o of r.outputs){ if(o.type==="tool.execution"){ const s=JSON.stringify(o.info||{}); const m=s.match(/https:[^"\\]+/); if(m){console.log(m[0]);process.exit(0)} } }
console.error(JSON.stringify(r.outputs).slice(0,2000)); process.exit(1)
' "$TMP/resp.json")
curl -s -o "$OUT" "$IMG"
ls -l "$OUT"
