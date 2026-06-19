# DecentraScholar - Setup & Run Guide

## Prerequisites

Install these before anything else.

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 20+ (LTS) | https://nodejs.org |
| npm | comes with Node | - |
| Git | any | https://git-scm.com |
| MetaMask | browser extension | https://metamask.io |
| PowerShell | 5.1+ (built into Windows) | - |

Verify your install:

```powershell
node --version   # should print v20.x.x or higher
npm --version    # should print 10.x.x or higher
```

---

## Install Dependencies

Open a terminal in the `Software` folder and run these three commands in order:

```powershell
# 1. Blockchain (Hardhat + Solidity toolchain)
cd backend\blockchain
npm install

# 2. Backend API
cd ..\api
npm install

# 3. Frontend
cd ..\..\frontend
npm install
```

Or all at once from the `Software` folder:

```powershell
npm install --prefix backend\blockchain && npm install --prefix backend\api && npm install --prefix frontend
```

---

## Environment Variables (optional)

The app runs fully on localhost without any env files.

If you have a Pinata account and want real IPFS pinning, create `backend\api\.env`:

```txt
PINATA_JWT=your_pinata_jwt_here
```

Without this, IPFS pinning will use local fallback (reviews still work).

---

## Run Everything

From the `Software` folder:

```powershell
cd path\to\Software
powershell -ExecutionPolicy Bypass -File "run-local.ps1"
```

This single command:

1. Starts a local Hardhat blockchain on `http://127.0.0.1:8545` (Chain ID 31337)
2. Deploys all 7 smart contracts
3. Seeds the DST treasury with ETH liquidity
4. Starts the backend API on `http://127.0.0.1:3001`
5. Starts the frontend on `http://127.0.0.1:5173`

Open `http://127.0.0.1:5173` in your browser when the script prints "Frontend is ready".

Press `Ctrl+C` to stop everything.

---

## MetaMask Setup

After the script starts, import test accounts into MetaMask.

**Network settings:**

- Network name: `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

**Test accounts (copy private key into MetaMask -> Import Account):**

| Index | Address | Private Key |
|-------|---------|-------------|
| 0 | 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 | 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 |
| 1 | 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 | 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d |
| 2 | 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc | 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a |
| 3 | 0x90f79bf6eb2c4f870365e785982e1f101e93b906 | 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 |
| 4 | 0x15d34aaf54267db7d7c367839aaf71a00a2c6a65 | 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a |
| 5 | 0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc | 0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba |
| 6 | 0x976ea74026e726554db657fa54763abd0c3a0aa9 | 0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e |
| 7 | 0x14dc79964da2c08b23698b3d3cc7ca32193d9955 | 0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356 |
| 8 | 0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f | 0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97 |
| 9 | 0xa0ee7a142d267c1f36714e4a8f75612f20a79720 | 0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6 |
| 10 | 0xbcd4042de499d14e55001ccbb24a551f3b954096 | 0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897 |
| 11 | 0x71be63f3384f5fb98995898a86b02fb2426c5788 | 0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82 |
| 12 | 0xfabb0ac9d68b0b445fb7357272ff202c5651694a | 0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1 |
| 13 | 0x1cbd3b2770909d4e10f157cabc84c7264073c9ec | 0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd |
| 14 | 0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097 | 0xc526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa |
| 15 | 0xcd3b766ccdd6ae721141f452c550ca635964ce71 | 0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61 |
| 16 | 0x2546bcd3c84621e976d8185a91a922ae77ecec30 | 0xea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0 |
| 17 | 0xbda5747bfd65f08deb54cb465eb87d40e51b197e | 0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd |
| 18 | 0xdd2fd4581271e230360230f9337d5c0430bf44c0 | 0xde9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0 |
| 19 | 0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199 | 0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e |

> Account 0 is reserved as the system coordinator. Use accounts 1-19 for testing author and reviewer roles.

---

## Test Flow

1. **Buy DST tokens** - connect with account 1, go to Profile tab, buy DST with ETH
2. **Submit a paper** - go to Author workspace, fill in details, submit (costs DST fee)
3. **Switch to account 2** - go to Reviewer workspace, find the paper in Available Reviews, stake + join
4. **Switch to account 3** - join the same paper as another reviewer
5. **Switch to account 4** - join the same paper as the third reviewer
6. **Submit reviews** - accounts 2, 3, and 4 write and submit blind reviews
7. **Backend auto-finalizes** - within seconds the chain listener tallies votes and finalizes
8. **Check result** - switch back to account 1, Author workspace shows the decision

---

## Troubleshooting

**"execution reverted" in MetaMask**

- The Hardhat node may have been restarted. Reset MetaMask account: Settings -> Advanced -> Clear activity tab data.

**Frontend shows stale data**

- Chain sync polls every 15 seconds. Wait or refresh the page.

**"Timed out waiting for http://127.0.0.1:8545"**

- The Hardhat node took too long to start. Re-run the script.

**npm install fails on `forge-std`**

- This is a dev-only dependency for Solidity tests. It won't affect running the app. Safe to ignore.
