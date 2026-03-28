import hre from 'hardhat';
import fs from 'fs';

async function main() {
  const [manufacturer, distributor, retailer, consumer, randomGuy] = await hre.ethers.getSigners();
  const expectedDistributor = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const expectedRetailer = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
  const rogueActor = randomGuy.address;

  const config = JSON.parse(fs.readFileSync('../frontend/src/config.json', 'utf8'));
  const contractAddress = config.contractAddress;
  const PharmaTracking = await hre.ethers.getContractFactory('PharmaTracking');
  const tracking = PharmaTracking.attach(contractAddress);

  console.log('Starting Simulation Sequence...');

  console.log('1. Manufacturer creating batch B-SIM...');
  const tx1 = await tracking.connect(manufacturer).createBatch('B-SIM', 'Amoxicillin 500mg', '2026-12', 'Origin Factory XYZ', expectedDistributor, expectedRetailer);
  await tx1.wait();
  console.log('Batch B-SIM Created!');

  console.log('2. Splitting B-SIM...');
  const tx2 = await tracking.connect(manufacturer).splitBatch('B-SIM', 2, expectedDistributor, 'Transit');
  await tx2.wait();
  console.log('Batch Split Complete: B-SIM-S1, B-SIM-S2');

  await tracking.connect(manufacturer).registerUser(rogueActor, 3);
  const signers = await hre.ethers.getSigners();
  const distributorSigner = signers[1];

  console.log('3. Triggering Route Deviation Alert...');
  const tx3 = await tracking.connect(distributorSigner).transferOwnership('B-SIM-S1', rogueActor, 2, 'Shady Warehouse');
  await tx3.wait();
  console.log('Transfer Complete.');

  console.log('4. Scanning 5 times to trigger Fraud...');
  for(let i=1; i<=5; i++) {
    const scanTx = await tracking.connect(consumer).recordScan('B-SIM-S2');
    await scanTx.wait();
    console.log('Scan ' + i + ' complete.');
  }

  console.log('5. Triggering Fake QR Alert...');
  const tx4 = await tracking.connect(consumer).reportFakeQR('FAKE-A-DRUG-X');
  await tx4.wait();
  console.log('Fake QR Reported!');

  console.log('Simulation Finished Successfully!');
}

main().catch(console.error);
