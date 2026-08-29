#!/bin/sh
# Trust the egress interception CA, then hand the machine over to the agent user.
#
# Every HTTPS request the machine makes is terminated by our own egress
# entrypoint (§5), which means the certificate it sees is the platform's, not
# the origin's. The CA for it is mounted at RUN time and cannot be baked into
# the image, so installing it is the first thing that happens on every boot —
# and a boot happens on every wake, because the disk does not survive a sleep.
#
# Without this, TLS to an allowed host fails verification and the machine reads
# it as "the internet is broken" rather than "I am behind a proxy".
set -eu

CA_SOURCE=/etc/cloudflare/certs/cloudflare-containers-ca.crt
CA_TARGET=/usr/local/share/ca-certificates/cloudflare-containers-ca.crt

# The CA is mounted by the platform around the time the container starts, and
# not necessarily before this script runs — so wait for it rather than racing it.
# A machine that missed the certificate reads every allowed host as a TLS
# failure, which is the confusing failure this loop exists to prevent.
waited=0
while [ ! -f "$CA_SOURCE" ] && [ "$waited" -lt 30 ]; do
  sleep 1
  waited=$((waited + 1))
done

if [ -f "$CA_SOURCE" ]; then
  cp "$CA_SOURCE" "$CA_TARGET"
  update-ca-certificates >/dev/null 2>&1 || echo "warning: could not refresh the trust store" >&2
else
  # Not fatal: a machine with no interception CA is one whose egress is not
  # being terminated, which is a configuration to notice rather than a crash.
  echo "warning: no interception CA after ${waited}s" >&2
fi

# Chromium does not read the system trust store: it carries its own (NSS), so a
# CA installed above is still a certificate error in the browser. Adding it here
# keeps verification ON and trusts exactly one more issuer — the alternative
# people reach for, --ignore-certificate-errors, would turn verification off for
# every site the agent visits.
if [ -f "$CA_SOURCE" ]; then
  su agent -s /bin/sh -c '
    set -e
    db="$HOME/.pki/nssdb"
    mkdir -p "$db"
    [ -f "$db/cert9.db" ] || certutil -N --empty-password -d sql:"$db"
    certutil -A -n cloudflare-containers -t "C,," -i '"$CA_SOURCE"' -d sql:"$db"
  ' || echo "warning: could not add the interception CA to the browser store" >&2
fi

# The display, and the service that grabs frames off it. Both run as the agent
# user: a screen a human can take control of must not be a root session, and the
# browser that draws on it is the least trustworthy program on the machine.
export DISPLAY="${DISPLAY:-:99}"
SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-800}"

setpriv --reuid=agent --regid=agent --init-groups \
  Xvfb "$DISPLAY" -screen 0 "${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24" -nolisten tcp >/tmp/xvfb.log 2>&1 &

# Wait for the display rather than racing the first frame grab.
waited=0
while ! setpriv --reuid=agent --regid=agent --init-groups xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
  waited=$((waited + 1))
  [ "$waited" -ge 20 ] && { echo "warning: no display after ${waited}s" >&2; break; }
  sleep 1
done

setpriv --reuid=agent --regid=agent --init-groups \
  node /usr/local/lib/screen.mjs >/tmp/screen.log 2>&1 &

# Nothing runs as root. The container must also outlive the command that woke
# it — the platform stops it on its own inactivity timer, and an entrypoint that
# exits would take the machine down between two commands of one run.
exec setpriv --reuid=agent --regid=agent --init-groups sleep infinity
