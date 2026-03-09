import { ethers, run } from "hardhat";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

type CliArgs = {
  fresh: boolean;
  anchorAddress?: string;
  anchorOwner?: string;
};

function repoRootFromHere(): string {
  return path.resolve(__dirname, "..", "..");
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { fresh: false };
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--fresh") {
      args.fresh = true;
      continue;
    }
    if (current === "--anchor" && argv[i + 1]) {
      args.anchorAddress = argv[i + 1];
      i += 1;
      continue;
    }
    if (current === "--anchor-owner" && argv[i + 1]) {
      args.anchorOwner = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function mustExist(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function statMs(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
}

function resolveTsNodeEsm(repoRoot: string): string {
  const binName = process.platform === "win32" ? "ts-node-esm.cmd" : "ts-node-esm";
  const localBin = path.join(repoRoot, "blockchain", "node_modules", ".bin", binName);
  if (!fs.existsSync(localBin)) {
    throw new Error(
      `Missing ${binName} in blockchain/node_modules/.bin. Run npm install inside blockchain first.`,
    );
  }
  return localBin;
}

function runRepoTsScript(repoRoot: string, relScriptPath: string, extraArgs: string[] = []): void {
  const runner = resolveTsNodeEsm(repoRoot);
  const scriptPath = path.join(repoRoot, relScriptPath);
  mustExist(scriptPath, `script ${relScriptPath}`);

  console.log(`> ${path.relative(repoRoot, scriptPath)} ${extraArgs.join(" ")}`.trim());
  execFileSync(runner, [scriptPath, ...extraArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

function verifierInputsChanged(repoRoot: string): boolean {
  const circuitPath = path.join(repoRoot, "zk", "circuits", "tally.circom");
  const metaPath = path.join(repoRoot, "zk", "circuits", "tally.meta.json");
  const verifierBuildPath = path.join(repoRoot, "zk", "build", "tally", "verifier.sol");
  const promotedSourcePath = path.join(repoRoot, "blockchain", "contracts", "TallyGroth16Verifier.sol");

  const sourceNewest = Math.max(statMs(circuitPath), statMs(metaPath));
  const generatedVerifierMs = statMs(verifierBuildPath);
  const promotedVerifierMs = statMs(promotedSourcePath);

  return generatedVerifierMs < sourceNewest || promotedVerifierMs < generatedVerifierMs;
}

function ensureVerifierSource(repoRoot: string, fresh: boolean): void {
  const verifierBuildPath = path.join(repoRoot, "zk", "build", "tally", "verifier.sol");
  const verificationKeyPath = path.join(repoRoot, "zk", "build", "tally", "verification_key.json");
  const promotedSourcePath = path.join(repoRoot, "blockchain", "contracts", "TallyGroth16Verifier.sol");

  const shouldRegenerate =
    fresh ||
    !fs.existsSync(verifierBuildPath) ||
    !fs.existsSync(verificationKeyPath) ||
    !fs.existsSync(promotedSourcePath) ||
    verifierInputsChanged(repoRoot);

  if (!shouldRegenerate) {
    console.log("Verifier source looks up to date. Skipping zk setup regeneration.");
    return;
  }

  console.log("Generating verifier artifacts from the current circuit...");
  runRepoTsScript(repoRoot, path.join("zk", "scripts", "snarkjs-setup.ts"), ["--force"]);

  console.log("Promoting verifier Solidity into blockchain/contracts...");
  runRepoTsScript(repoRoot, path.join("zk", "scripts", "promote-verifier-sol.ts"));

  mustExist(verifierBuildPath, "generated verifier.sol");
  mustExist(verificationKeyPath, "verification key");
  mustExist(promotedSourcePath, "promoted verifier contract");
}

async function ensureAnchor(anchorAddressFromCli?: string, anchorOwnerFromCli?: string): Promise<string> {
  const anchorFromEnv = process.env.ANCHOR_ADDRESS?.trim();
  const anchorAddress = anchorAddressFromCli?.trim() || anchorFromEnv;
  if (anchorAddress) {
    console.log("Using existing ElectionRootAnchor:", anchorAddress);
    return anchorAddress;
  }

  const owner = anchorOwnerFromCli?.trim() || process.env.ANCHOR_OWNER?.trim();
  const [deployer] = await ethers.getSigners();
  const anchorOwner = owner || deployer.address;

  console.log("No ANCHOR_ADDRESS provided. Deploying ElectionRootAnchor...");
  console.log("Anchor owner:", anchorOwner);

  const Anchor = await ethers.getContractFactory("ElectionRootAnchor");
  const anchor = await Anchor.deploy(anchorOwner);
  await anchor.waitForDeployment();
  const deployedAddress = await anchor.getAddress();

  console.log("ElectionRootAnchor deployed to:", deployedAddress);
  return deployedAddress;
}

async function main() {
  const cli = parseArgs(process.argv);
  const repoRoot = repoRootFromHere();

  const [deployer] = await ethers.getSigners();
  const balance = await deployer.provider.getBalance(deployer.address);

  console.log("Deployer:", deployer.address);
  console.log("Deployer balance:", balance.toString());
  console.log("Fresh verifier regeneration:", cli.fresh ? "enabled" : "auto");

  ensureVerifierSource(repoRoot, cli.fresh);

  await run("compile");

  const anchorAddress = await ensureAnchor(cli.anchorAddress, cli.anchorOwner);

  const Verifier = await ethers.getContractFactory("TallyGroth16Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  console.log("TallyGroth16Verifier deployed to:", verifierAddr);

  const Registry = await ethers.getContractFactory("ElectionTallyRegistry");
  const registry = await Registry.deploy(verifierAddr, anchorAddress);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log("ElectionTallyRegistry deployed to:", registryAddr);

  console.log("\n=== ENV OUTPUT ===");
  console.log(`ANCHOR_ADDRESS=${anchorAddress}`);
  console.log(`VERIFIER_ADDRESS=${verifierAddr}`);
  console.log(`REGISTRY_ADDRESS=${registryAddr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
