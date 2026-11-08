# QQ main desktop implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this approved direct migration.

**Goal:** Show the fish QQ on Simon's existing Ubuntu desktop and remove the separate container desktop.

**Architecture:** Retain the installed QQ/gateway image and its three persistent data mounts. Replace its virtual desktop startup with QQ and gateway processes connected to the authenticated host X11 display. Keep OneBot ports and credentials unchanged; retire the old desktop container after the main-desktop window is verified.

**Tech Stack:** Existing Docker image, supervisord, X11, systemd; no new graphical server.

**Spec:** User instruction: “那套桌面直接删掉，用主桌面”. Preserve account data; one QQ owner only. No synthetic messages.

- [x] Inspect exact startup script, account ownership and X11 access; bound all server probes.
- [x] Prepare private recovery metadata and a startup configuration with only QQ/gateway processes; validate image, mounts, local-only ports and Xauthority handling.
- [x] Stop the old container, launch QQ on the main desktop under resource limits, verify its window and gateway/login state.
- [x] Remove the old virtual-desktop container and its startup path, leaving data intact. Verify persistence and give the user the single main-desktop entry.

Operational probes: at most 64 KiB configuration input per stage, 200 process rows, 25–45 seconds, 128–256 MiB memory, swap 0, CPU 25%, tasks 16. GUI runtime receives an explicit cgroup limit. Do not expose a new network desktop or use xhost +.

## Deployment evidence — 2026-11-06

`chopsticks-qq-main.service` is enabled and active. Its container uses the existing image and three account-data mounts; only QQ, its gateway, and DBus run inside it. QQ windows are present on host X11 `:0`. Runtime caps: 1 GiB RAM, no swap, 0.75 CPU, 256 processes. Gateway ports remain loopback-only (3000/3001/5099).

Removed the stopped `snowluma` container, its active Compose file, and both `snowluma-desktop-lan` systemd units. Port 6081 no longer listens. Main desktop remains at `http://192.168.5.234:6080/vnc.html`. Account files remain intact.

Fresh-context review found an orphan-container restart failure. Added ownership-checked retirement before relaunch; two regression cases passed (known orphan recovery and refusing an unknown owner). Corrected the image user UID/GID from 1001 to the existing account-data UID/GID 1000. Main-desktop acceptance passed. Final read-only OneBot checks returned matching account, `online=true`, `good=true`.

Operational scripts and private evidence are outside the repository, with deployed startup configuration in `/var/lib/chopsticks/qq-main`. No synthetic messages were sent. Browser preview was unavailable through the browser tool; server X11 window enumeration confirmed the displayed QQ windows.

After the normal adapter retry, Chopsticks reported `connected=true`, `started=true`, `receiveHealthy=true`, `lastError=null`; health age was 1.4 seconds. No manual login action was needed.
