param(
  [switch]$NoWait
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$blockchainDir = Join-Path $rootDir "backend\blockchain"
$apiDir = Join-Path $rootDir "backend\api"
$frontendDir = Join-Path $rootDir "frontend"
$frontendEnvPath = Join-Path $frontendDir ".env.local"
$modulePath = Join-Path $blockchainDir "ignition\modules\DecentraScholar.ts"

$accounts = @(
  @{ Index =  0; Address = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"; PrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" }
  @{ Index =  1; Address = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"; PrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" }
  @{ Index =  2; Address = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"; PrivateKey = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" }
  @{ Index =  3; Address = "0x90f79bf6eb2c4f870365e785982e1f101e93b906"; PrivateKey = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" }
  @{ Index =  4; Address = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65"; PrivateKey = "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" }
  @{ Index =  5; Address = "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc"; PrivateKey = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" }
  @{ Index =  6; Address = "0x976ea74026e726554db657fa54763abd0c3a0aa9"; PrivateKey = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" }
  @{ Index =  7; Address = "0x14dc79964da2c08b23698b3d3cc7ca32193d9955"; PrivateKey = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" }
  @{ Index =  8; Address = "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f"; PrivateKey = "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" }
  @{ Index =  9; Address = "0xa0ee7a142d267c1f36714e4a8f75612f20a79720"; PrivateKey = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" }
  @{ Index = 10; Address = "0xbcd4042de499d14e55001ccbb24a551f3b954096"; PrivateKey = "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897" }
  @{ Index = 11; Address = "0x71be63f3384f5fb98995898a86b02fb2426c5788"; PrivateKey = "0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82" }
  @{ Index = 12; Address = "0xfabb0ac9d68b0b445fb7357272ff202c5651694a"; PrivateKey = "0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1" }
  @{ Index = 13; Address = "0x1cbd3b2770909d4e10f157cabc84c7264073c9ec"; PrivateKey = "0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd" }
  @{ Index = 14; Address = "0xdf3e18d64bc6a983f673ab319ccae4f1a57c7097"; PrivateKey = "0xc526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa" }
  @{ Index = 15; Address = "0xcd3b766ccdd6ae721141f452c550ca635964ce71"; PrivateKey = "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61" }
  @{ Index = 16; Address = "0x2546bcd3c84621e976d8185a91a922ae77ecec30"; PrivateKey = "0xea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0" }
  @{ Index = 17; Address = "0xbda5747bfd65f08deb54cb465eb87d40e51b197e"; PrivateKey = "0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd" }
  @{ Index = 18; Address = "0xdd2fd4581271e230360230f9337d5c0430bf44c0"; PrivateKey = "0xde9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0" }
  @{ Index = 19; Address = "0x8626f6940e2eb28930efb4cef49b2d1f2c9c1199"; PrivateKey = "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e" }
)

$jobs = @()

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Script
  )

  & $Script
  if ($LASTEXITCODE -ne 0) {
    throw "Native command failed with exit code $LASTEXITCODE."
  }
}

function Wait-ForUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 30,
    [string]$Method = "Get",
    [string]$Body = ""
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      if ($Method -eq "Post") {
        Invoke-RestMethod -Uri $Url -Method Post -ContentType "application/json" -Body $Body | Out-Null
      } else {
        Invoke-WebRequest -Uri $Url -UseBasicParsing | Out-Null
      }
      return
    } catch {
      Start-Sleep -Milliseconds 750
    }
  }

  throw "Timed out waiting for $Url"
}

function Show-JobOutput {
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.Job]$Job
  )

  $output = Receive-Job -Job $Job -Keep -ErrorAction SilentlyContinue
  if ($output) {
    $output | ForEach-Object { Write-Host $_ }
  }
}

try {
  Write-Host "Starting Hardhat node..."
  $hardhatJob = Start-Job -Name "hardhat-node" -ScriptBlock {
    param($dir)
    Set-Location $dir
    & ".\node_modules\.bin\hardhat.cmd" node --hostname 127.0.0.1 --port 8545
  } -ArgumentList $blockchainDir
  $jobs += $hardhatJob

  Wait-ForUrl -Url "http://127.0.0.1:8545" -Method "Post" -Body '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' -TimeoutSeconds 30
  Write-Host "Hardhat node is ready on http://127.0.0.1:8545"

  Write-Host "Deploying contracts..."
  Push-Location $blockchainDir
  try {
    Invoke-NativeCommand { & ".\node_modules\.bin\hardhat.cmd" ignition deploy $modulePath --network localhost --reset }
  } finally {
    Pop-Location
  }

  $deploymentFile = Join-Path $blockchainDir "ignition\deployments\chain-31337\deployed_addresses.json"
  $addresses = Get-Content $deploymentFile | ConvertFrom-Json

  $envFile = @"
VITE_CHAIN_RPC_URL=http://127.0.0.1:8545
VITE_PAPER_REGISTRY_ADDRESS=$($addresses.'DecentraScholarModule#PaperRegistry')
VITE_READER_INTERACTIONS_ADDRESS=$($addresses.'DecentraScholarModule#ReaderInteractions')
VITE_REVIEW_MANAGER_ADDRESS=$($addresses.'DecentraScholarModule#ReviewManager')
VITE_REVIEWER_REPUTATION_ADDRESS=$($addresses.'DecentraScholarModule#ReviewerReputation')
VITE_DST_TOKEN_ADDRESS=$($addresses.'DecentraScholarModule#DSTToken')
VITE_DST_TREASURY_ADDRESS=$($addresses.'DecentraScholarModule#DSTTreasury')
VITE_DST_PROTOCOL_VAULT_ADDRESS=$($addresses.'DecentraScholarModule#DSTProtocolVault')
VITE_READER_INTERACTIONS_API_URL=http://127.0.0.1:3001
VITE_IPFS_GATEWAY_URL=https://dweb.link/ipfs
"@
  Set-Content -Path $frontendEnvPath -Value $envFile
  Write-Host "Updated frontend .env.local with the fresh deployment addresses."

  Write-Host "Seeding local treasury..."
  Push-Location $blockchainDir
  try {
    $env:PAPER_REGISTRY_ADDRESS = $addresses.'DecentraScholarModule#PaperRegistry'
    $env:REVIEW_MANAGER_ADDRESS = $addresses.'DecentraScholarModule#ReviewManager'
    $env:DST_TREASURY_ADDRESS = $addresses.'DecentraScholarModule#DSTTreasury'
    Invoke-NativeCommand { & ".\node_modules\.bin\hardhat.cmd" run ".\scripts\seed-localhost.js" --network localhost }
  } finally {
    Pop-Location
  }

  # Load optional backend .env for secrets like PINATA_JWT
  $backendEnvPath = Join-Path $apiDir ".env"
  $backendEnv = @{}
  if (Test-Path $backendEnvPath) {
    Get-Content $backendEnvPath | ForEach-Object {
      if ($_ -match "^\s*([A-Z0-9_]+)\s*=\s*(.+)\s*$") {
        $backendEnv[$Matches[1]] = $Matches[2]
      }
    }
  }

  Write-Host "Starting backend API..."
  $coordinatorKey = $accounts[0].PrivateKey
  $apiJob = Start-Job -Name "backend-api" -ScriptBlock {
    param($dir, $extraEnv, $chainEnv)
    Set-Location $dir
    foreach ($key in $extraEnv.Keys) {
      [System.Environment]::SetEnvironmentVariable($key, $extraEnv[$key], "Process")
    }
    foreach ($key in $chainEnv.Keys) {
      [System.Environment]::SetEnvironmentVariable($key, $chainEnv[$key], "Process")
    }
    & node server.js
  } -ArgumentList $apiDir, $backendEnv, @{
    CHAIN_RPC_URL = "http://127.0.0.1:8545"
    COORDINATOR_PRIVATE_KEY = $coordinatorKey
    PAPER_REGISTRY_ADDRESS = $addresses.'DecentraScholarModule#PaperRegistry'
    REVIEW_MANAGER_ADDRESS = $addresses.'DecentraScholarModule#ReviewManager'
    REVIEWER_REPUTATION_ADDRESS = $addresses.'DecentraScholarModule#ReviewerReputation'
    DST_PROTOCOL_VAULT_ADDRESS = $addresses.'DecentraScholarModule#DSTProtocolVault'
    REVIEW_DEADLINE_DAYS = "14"
  }
  $jobs += $apiJob

  Wait-ForUrl -Url "http://127.0.0.1:3001/health" -TimeoutSeconds 20
  Write-Host "Backend API is ready on http://127.0.0.1:3001"

  Write-Host "Starting Vite frontend..."
  $frontendJob = Start-Job -Name "frontend-vite" -ScriptBlock {
    param($dir)
    Set-Location $dir
    & npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
  } -ArgumentList $frontendDir
  $jobs += $frontendJob

  Wait-ForUrl -Url "http://127.0.0.1:5173" -TimeoutSeconds 30
  Write-Host "Frontend is ready on http://127.0.0.1:5173"

  Write-Host ""
  Write-Host "Local stack summary"
  Write-Host "RPC:      http://127.0.0.1:8545 (Chain ID 31337)"
  Write-Host "API:      http://127.0.0.1:3001"
  Write-Host "Frontend: http://127.0.0.1:5173"
  Write-Host ""
  Write-Host "Contracts"
  Write-Host "PaperRegistry:      $($addresses.'DecentraScholarModule#PaperRegistry')"
  Write-Host "ReaderInteractions: $($addresses.'DecentraScholarModule#ReaderInteractions')"
  Write-Host "ReviewManager:      $($addresses.'DecentraScholarModule#ReviewManager')"
  Write-Host "ReviewerReputation: $($addresses.'DecentraScholarModule#ReviewerReputation')"
  Write-Host "DSTToken:           $($addresses.'DecentraScholarModule#DSTToken')"
  Write-Host "DSTTreasury:        $($addresses.'DecentraScholarModule#DSTTreasury')"
  Write-Host "DSTProtocolVault:   $($addresses.'DecentraScholarModule#DSTProtocolVault')"
  Write-Host ""
  Write-Host "MetaMask import accounts"
  $accounts | ForEach-Object {
    Write-Host ("[{0}] {1}  {2}" -f $_.Index, $_.Address, $_.PrivateKey)
  }
  Write-Host ""
  Write-Host "Import one of the private keys above into MetaMask, then switch MetaMask to RPC http://127.0.0.1:8545 with Chain ID 31337."

  if ($NoWait) {
    Write-Host "NoWait requested; stopping services after startup verification."
    return
  }

  Write-Host "Services will keep running while this script stays open. Press Ctrl+C to stop them."
  while ($true) {
    foreach ($job in $jobs) {
      if ($job.State -ne "Running") {
        throw "Background job '$($job.Name)' stopped unexpectedly."
      }
    }
    Start-Sleep -Seconds 3
  }
} finally {
  foreach ($job in $jobs) {
    if ($null -ne $job) {
      if ($job.State -eq "Failed") {
        Write-Host ""
        Write-Host "Output from failed job '$($job.Name)':"
        Show-JobOutput -Job $job
      }
      Stop-Job -Job $job -ErrorAction SilentlyContinue | Out-Null
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue | Out-Null
    }
  }
}
