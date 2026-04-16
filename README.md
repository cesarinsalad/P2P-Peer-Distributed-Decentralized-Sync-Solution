<div align="center">

# 🔄 P2P-Sync Hub

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white) 
![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white) 
![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)

A powerful terminal tool for smart file and directory synchronization between computers on the same local network, operating 100% via true **Peer-To-Peer** routing without relying on third-party clouds or central servers.

</div>

## ✨ Features

* **🌍 Magic Discovery (`mDNS`)**: Nodes connected to the same Wi-Fi or LAN will automatically find each other "over the air". Zero complex IP configurations required.
* **⚡ Differential Synchronization (`Rsync-like`)**: If you change a single line in a 2GB file, the program calculates *hashes* and will exclusively squirt the modified fragment across to the peer, heavily saving bandwidth.
* **👀 Real-Time Reactions (`FS Watcher`)**: Powered by native asynchronous events, this service reacts in milliseconds to any edit in your file tree and propagates it to your connected clients.
* **🛡️ Conservative Conflict Resolution**: We blindly trust the *Last Write Wins (LWW)* policy. But if someone edited your file remotely and concurrently from another machine, the system generates `.conflict-backup` copies so you never suffer file loss due to race conditions.
* **🚫 `.ignore` Protection Extension**: Add filters in pure `.gitignore` style to skip synchronizing secrets (`.env`) and ignore the hellish transfer of `node_modules/` folders.

---

## 🚀 Quick Installation

Make sure you have an environment provided by [Node.js](https://nodejs.org/) (v16 or higher recommended).

1. Clone the repository and enter the ecosystem:
   ```bash
   git clone https://github.com/cesarinsalad/P2P-Peer-Distributed-Decentralized-Sync-Solution.git
   cd P2P-Peer-Distributed-Decentralized-Sync-Solution
   ```
2. Install the dependency engine (to decode compression, watchers, and parameters):
   ```bash
   npm install
   ```

---

## 🛠️ Typical Usage (LAN / Wi-Fi)

Configured dynamically as a modular CLI, the user decides if they want to mirror a system directory from one device to another on the other corner of the room.

1. **Computer A:** 
```bash
npm start -- -d /home/user/Pictures/HiddenBackup
```

2. **Computer B:** 
```bash
npm start -- -d C:\MyDocuments\PhotoMirror
```

Both computers will asynchronously validate their signatures and immediately launch a fast native TCP bridge thanks to the `mDNS` protocol.

---

## 🔌 Advanced Usage (Traversing Subnets / Dockers / WSL)

There are modern networking edge cases like **WSL2** or **VirtualBox** where the network interface lives trapped under a strict NAT, and mDNS broadcasts never cross over to the internal Router's network interface.

When faced with this, the console provides a manual *flag* (`--peer`). This invites the captive node to pierce the virtual sub-net and explicitly connect tunnel-to-tunnel.

* In the lean terminal of your primary network, fix a convenient port:
  ```bash
  npm start -- -p 9090 -d /SharedFiles
  ```
* In your virtual Linux distribution (WSL, client), proactively connect to the real host IP to detonate the remote sockets:
  ```bash
  npm start -- -d ~/Workspace --peer 192.168.1.20:9090
  ```

---

## 🤝 CLI Commands Help

For instant reference, query the tool's integrated help menu:

```bash
npm start -- --help
```

```text
Usage: p2p-sync [options]

Decentralized P2P file synchronization tool

Options:
  -V, --version           output the version number
  -p, --port <number>     Port to initialize the node (default: "13840")
  -d, --dir <path>        Directory to synchronize (default: current directory)
  -P, --peer <host:port>  Manually connect to a known peer (e.g. 192.168.1.20:12345)
  -h, --help              display help for command
```
