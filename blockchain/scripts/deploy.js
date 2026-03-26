import hre from "hardhat";

async function main() {
  const PharmaTracking = await hre.ethers.getContractFactory("PharmaTracking");
  const tracking = await PharmaTracking.deploy();

  await tracking.waitForDeployment();

  console.log(`PharmaTracking deployed to ${tracking.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
