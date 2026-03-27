import hre from "hardhat";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.resolve(__dirname, "../../frontend/src/config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const PharmaTracking = await hre.ethers.getContractAt("PharmaTracking", config.contractAddress, signer);
  
  const count = await PharmaTracking.batchCount();
  console.log("Current Batch Count:", count.toString());
  
  if (count > 0) {
    console.log("SUCCESS: Batches exist on the local blockchain!");
  } else {
    console.log("WARNING: No batches found on the local blockchain yet.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
