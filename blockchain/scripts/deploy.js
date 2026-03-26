import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const PharmaTracking = await hre.ethers.getContractFactory("PharmaTracking");
  const tracking = await PharmaTracking.deploy();

  await tracking.waitForDeployment();
  const address = tracking.target;
  console.log(`PharmaTracking deployed to ${address}`);

  // Bridge frontend configs
  const frontendConfigPath = path.resolve(__dirname, "../../frontend/src/config.json");
  const artifactPath = path.resolve(__dirname, "../artifacts/contracts/PharmaTracking.sol/PharmaTracking.json");
  
  if (fs.existsSync(artifactPath)) {
    const artifactData = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    const configData = {
      contractAddress: address,
      abi: artifactData.abi
    };
    fs.writeFileSync(frontendConfigPath, JSON.stringify(configData, null, 2));
    console.log(`✅ Front-End Automagically Bridged: Configuration written to frontend/src/config.json`);
  } else {
    console.log("Could not find contract artifacts to bridge to frontend.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
