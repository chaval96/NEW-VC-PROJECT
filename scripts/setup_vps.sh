#!/bin/bash
set -euo pipefail

apt update && apt upgrade -y
apt install -y git tmux curl wget build-essential python3 python3-pip jq htop
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
python3 -m pip install --ignore-installed aider-chat --break-system-packages

if ! grep -q 'HOME/.local/bin' ~/.bashrc; then
  echo 'export PATH=$PATH:$HOME/.local/bin' >> ~/.bashrc
fi

echo "Node: $(node --version)"
echo "NPM:  $(npm --version)"
echo "Aider: $(aider --version 2>/dev/null || /usr/local/bin/aider --version 2>/dev/null || echo missing)"
