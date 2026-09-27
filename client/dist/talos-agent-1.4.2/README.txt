Talos Agent 1.4.2

1. Copy this folder to the target machine, e.g. C:\Talos
2. Double-click setup.bat  (or run: scripts\install.bat --server HOST:9443 --token TOKEN)
3. It writes conf\agent.yml, registers the keepalive task and starts the agent.

Other commands:
  scripts\start.bat     start the agent
  scripts\stop.bat      stop the agent
  scripts\status.bat    show status and recent logs
  scripts\upgrade.bat   upgrade to the server's current release
  scripts\uninstall.bat remove the keepalive task and stop the agent

Requirements: JRE 17 or newer on PATH.
