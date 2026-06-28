#!/bin/bash
# 수업 시작 스크립트
# 사용법: bash start.sh
#
# 네트워크 구조 (WSL2 미러링 모드 대응):
#   학생 기기 → http://<LAN_IP>:3000 → Windows 포트포워딩 → 127.0.0.1:3001 → WSL 서버
#   - WSL 서버는 BACKEND_PORT(3001)에서 listen
#   - Windows가 PUBLIC_PORT(3000)로 들어온 LAN 트래픽을 localhost:3001로 중계
#   - 미러링 모드에서 LAN IP로 직접 들어온 패킷은 WSL까지 전달되지 않으므로 이 중계가 필수
#   (NAT 모드면 기존 방식대로 portproxy가 WSL_IP로 직접 포워딩)

set -u
PUBLIC_PORT=3000
BACKEND_PORT=3001
# WSL2 가상 스위치의 표준 Hyper-V VMCreator GUID (모든 WSL2 설치에서 동일한 고정값).
# 미러링 모드에서 Hyper-V 방화벽 인바운드를 허용하기 위해 사용한다.
HYPERV_WSL_ID='{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'

echo ""
echo "========================================="
echo "  HTML 만들기 수업 - 서버 시작"
echo "========================================="
echo ""

cd "$(dirname "$0")"

# 1. 기존 서버 종료 (public/backend 양쪽 정리)
for p in "$PUBLIC_PORT" "$BACKEND_PORT"; do
  PIDS=$(lsof -t -i:"$p" 2>/dev/null)
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null
done
pkill -f "node server.js" 2>/dev/null
sleep 1

# 2. WSL2 IP 확인
WSL_IP=$(hostname -I | awk '{print $1}')
echo "[1/4] WSL IP: $WSL_IP"

# 3. 네트워크 모드 판별
#    172.x → NAT 모드, 그 외(192.168.x 등 LAN IP 직접 보유) → 미러링 모드
case "$WSL_IP" in
  172.*) MIRRORED=0 ;;
  *)     MIRRORED=1 ;;
esac

if [ "$MIRRORED" -eq 1 ]; then
  echo "[2/4] 미러링 모드 - 서버는 :$BACKEND_PORT, Windows가 :$PUBLIC_PORT → 127.0.0.1:$BACKEND_PORT 중계"
  SERVER_PORT=$BACKEND_PORT
  PROXY_CONNECT="127.0.0.1"
  PROXY_CONNECT_PORT=$BACKEND_PORT
else
  echo "[2/4] NAT 모드 - 서버는 :$PUBLIC_PORT, Windows가 :$PUBLIC_PORT → $WSL_IP:$PUBLIC_PORT 중계"
  SERVER_PORT=$PUBLIC_PORT
  PROXY_CONNECT="$WSL_IP"
  PROXY_CONNECT_PORT=$PUBLIC_PORT
fi

# 4. 서버 시작 (백그라운드, 세션 종료에도 살아남도록 nohup)
echo "[3/4] 서버 시작 중... (port $SERVER_PORT)"
PORT=$SERVER_PORT HOST=0.0.0.0 nohup node server.js > /tmp/html-class-server.log 2>&1 &
sleep 3
if ! curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$SERVER_PORT"; then
  echo "  [!] ⚠️ 서버가 응답하지 않습니다. 로그:"
  sed 's/^/      /' /tmp/html-class-server.log
fi

# 5. Windows 방화벽 + 포트포워딩 설정 (단일 관리자 PowerShell 호출 = UAC 1회)
echo "[4/4] Windows 방화벽/포트포워딩 설정 중... (UAC 창이 뜨면 '예')"
PS_SETUP="\
netsh interface portproxy delete v4tov4 listenport=$PUBLIC_PORT listenaddress=0.0.0.0 2>\$null; \
netsh interface portproxy add v4tov4 listenport=$PUBLIC_PORT listenaddress=0.0.0.0 connectport=$PROXY_CONNECT_PORT connectaddress=$PROXY_CONNECT; \
netsh advfirewall firewall delete rule name=HtmlClassServer 2>\$null; \
netsh advfirewall firewall add rule name=HtmlClassServer dir=in action=allow protocol=TCP localport=$PUBLIC_PORT profile=any; \
try { Set-NetFirewallHyperVVMSetting -Name '$HYPERV_WSL_ID' -DefaultInboundAction Allow -ErrorAction SilentlyContinue } catch {}"
powershell.exe -Command "Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-Command','$PS_SETUP'" 2>/dev/null
sleep 2

# 6. 학생 접속 주소 = Windows WiFi/LAN IP (미러링 모드에선 WSL_IP와 동일)
LAN_IP=$(powershell.exe -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.InterfaceAlias -match 'Wi-Fi|WiFi|Wireless|이더넷|Ethernet' -and \$_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01]))\.' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r\n ')
[ -z "$LAN_IP" ] && LAN_IP="$WSL_IP"

# 7. 실제 도달 검증 (Windows에서 LAN IP:PORT TCP 연결 테스트)
REACH=$(powershell.exe -Command "(Test-NetConnection -ComputerName $LAN_IP -Port $PUBLIC_PORT -WarningAction SilentlyContinue).TcpTestSucceeded" 2>/dev/null | tr -d '\r\n ')

echo ""
echo "========================================="
echo "  수업 준비 완료!"
echo "========================================="
echo ""
echo "  학생 접속 주소:"
echo ""
echo "    http://${LAN_IP}:${PUBLIC_PORT}"
echo ""
if [ "$REACH" = "True" ]; then
  echo "  ✓ 접속 경로 정상 (Windows→서버 연결 확인)"
else
  echo "  [!] ⚠️ 접속 경로 검증 실패 — UAC를 승인했는지, 같은 WiFi인지 확인하세요."
  echo "      그래도 안 되면 공유기의 기기 간 차단(AP isolation)일 수 있어 다른 WiFi/핫스팟 필요."
fi
echo ""
echo "  서버 종료: 'lsof -t -i:${BACKEND_PORT} | xargs kill' 또는 '수업 끝'"
echo "========================================="
echo ""
