import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { Wallet, ShieldCheck, Settings, ArrowRight, CheckCircle2, User, Building2, Search, ArrowLeft, Pill, QrCode, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Html5QrcodeScanner } from "html5-qrcode";
import config from "./config.json";
const contractAddress = config.contractAddress;
const contractABI = config.abi;

const ROLES = { 0: "None", 1: "Manufacturer", 2: "Distributor", 3: "Retailer / Healthcare Provider" };
const STATUS = { 0: "Manufactured", 1: "In Transit", 2: "Delivered" };

// Sub-component for QR Scanner using html5-qrcode
const QRScannerPlugin = ({ onScanSuccess, onScanFailure }) => {
  useEffect(() => {
    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    );
    scanner.render(onScanSuccess, onScanFailure);

    return () => {
      scanner.clear().catch(e => console.error("Failed to clear scanner", e));
    };
  }, []);
  return <div id="qr-reader" className="w-full max-w-sm mx-auto overflow-hidden rounded-xl border-2 border-slate-700"></div>;
};

export default function App() {
  const [view, setView] = useState("landing");
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [role, setRole] = useState(0);

  // Forms mapping
  const [batchName, setBatchName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [location, setLocation] = useState("");
  
  const [transferId, setTransferId] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferStatus, setTransferStatus] = useState(1);
  const [transferLoc, setTransferLoc] = useState("");

  const [verifyId, setVerifyId] = useState("");
  const [batchInfo, setBatchInfo] = useState(null);
  const [batchHistory, setBatchHistory] = useState([]);

  // Modal & QR specific states
  const [mintedBatchId, setMintedBatchId] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanTarget, setScanTarget] = useState(""); // "verify" or "transfer"
  const [hasScannedParam, setHasScannedParam] = useState(false);

  // Initial load check for query parameters ?batch=...
  useEffect(() => {
    checkConnection();
    
    if (window.ethereum) {
      window.ethereum.on('chainChanged', () => {
        window.location.reload();
      });
      window.ethereum.on('accountsChanged', () => {
        window.location.reload();
      });
    }

    // Auto-Verify if a parameter is present (e.g. they scanned a QR code pointing to localhost/?batch=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const batchFromUrl = urlParams.get('batch');
    
    if (batchFromUrl && !hasScannedParam) {
      setHasScannedParam(true); // Ensure we only trigger this once
      setView("customer");
      setVerifyId(batchFromUrl);
      // Wait a moment for rendering, then run verification
      setTimeout(() => verifyBatchId(batchFromUrl), 1000); 
    }
  }, [view]);

  const checkConnection = async () => {
    if (window.ethereum) {
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts.length > 0) connectWallet();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) return alert("Please install MetaMask.");
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // Prevent user from connecting to wrong network
      const network = await provider.getNetwork();
      if (network.chainId !== 11155111n) {
        alert("🚨 WRONG NETWORK SELECTED IN METAMASK!\n\nYou must switch to 'Sepolia' (Chain ID: 11155111).\n\nPlease switch your MetaMask network to Sepolia to interact with PharmaChain!");
        return;
      }

      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setProvider(provider);
      setAccount(addr);
      
      const pContract = new ethers.Contract(contractAddress, contractABI, signer);
      setContract(pContract);

      try {
        const r = await pContract.getMyRole();
        setRole(Number(r));
      } catch (e) {
        console.log("No role assigned");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const registerRole = async (selectedRole) => {
    if (!contract || !account) return alert("Please connect wallet first");
    try {
      const tx = await contract.registerUser(account, selectedRole);
      await tx.wait();
      alert("Role assigned successfully!");
      setRole(selectedRole);
    } catch (err) {
      console.error(err);
      alert("Error assigning role.");
    }
  }

  const createBatch = async (e) => {
    e.preventDefault();
    if (!contract) return;
    try {
      const tx = await contract.createBatch(batchName, expiry, location);
      await tx.wait();
      
      // Fetch latest batch ID to generate QR
      const latestCount = await contract.batchCount();
      setMintedBatchId(latestCount.toString());
      
      setBatchName(""); setExpiry(""); setLocation("");
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes("Internal error")) {
        alert("Transaction Failed! ❌\n\nIt looks like you are trying to send a transaction to the wrong blockchain or contract. Please ensure MetaMask is on Sepolia.");
      } else {
        alert("Error creating batch. Check console for details.");
      }
    }
  };

  const transferBatch = async (e) => {
    e.preventDefault();
    if (!contract) return;
    try {
      const tx = await contract.transferOwnership(transferId, transferTo, transferStatus, transferLoc);
      await tx.wait();
      alert("Batch Transfer Recorded Immuntably!");
      setTransferId(""); setTransferTo(""); setTransferLoc("");
    } catch (err) {
      console.error(err);
      if (err.message && err.message.includes("Internal error")) {
        alert("Transaction Failed! ❌\n\nPlease ensure MetaMask is connected to Sepolia.");
      } else {
        alert("Error transferring batch. Verify you are the current owner.");
      }
    }
  };

  const verifyBatchId = async (idToVerify) => {
    if (!idToVerify) return;
    
    // Fallback to a read-only provider if wallet isn't connected (for Customers)
    let readContract = contract;
    if (!readContract) {
      const readProvider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
      readContract = new ethers.Contract(contractAddress, contractABI, readProvider);
    }

    try {
      const data = await readContract.getBatch(idToVerify);
      if(!data.exists) throw new Error("Batch doesn't exist");
      const history = await readContract.getBatchHistory(idToVerify);
      setBatchInfo(data);
      setBatchHistory(history);
    } catch (err) {
      console.error(err);
      alert("Batch not found on Blockchain.");
      setBatchInfo(null);
    }
  };

  const verifyBatch = async (e) => {
    e.preventDefault();
    verifyBatchId(verifyId);
  };

  // QR Scan Callback
  const handleScanSuccess = (decodedText) => {
    // Determine if it's our full URL (extract batch ID) or just a number
    let scannedId = decodedText;
    if (decodedText.includes("?batch=")) {
      scannedId = new URL(decodedText).searchParams.get("batch");
    }

    if (scanTarget === "verify") {
      setVerifyId(scannedId);
      setShowScanner(false);
      verifyBatchId(scannedId);
    } else if (scanTarget === "transfer") {
      setTransferId(scannedId);
      setShowScanner(false);
    }
  };

  // Landing view
  if (view === "landing") {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4">
        <div className="mb-12 flex flex-col items-center">
          <ShieldCheck className="text-cyan-400 w-20 h-20 mb-4" />
          <h1 className="text-5xl font-extrabold text-white text-center">
            PharmaChain
          </h1>
          <p className="text-slate-400 mt-3 text-lg text-center max-w-lg">
            Securing the pharmaceutical supply chain using immutable blockchain ledgers.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl w-full">
          <button 
            onClick={() => setView("customer")}
            className="group relative bg-slate-800 border border-slate-700 hover:border-cyan-500 rounded-3xl p-8 transition-all hover:-translate-y-1 hover:shadow-[0_10px_40px_-10px_rgba(6,182,212,0.3)] text-left flex flex-col items-center justify-center min-h-[250px]"
          >
            <div className="bg-cyan-500/10 p-5 rounded-2xl text-cyan-400 group-hover:scale-110 transition-transform mb-6">
              <Search className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Verify Customer</h2>
            <p className="text-slate-400 text-center">
              I am a patient or consumer checking the authenticity and origin of my medicine.
            </p>
          </button>

          <button 
            onClick={() => setView("industry")}
            className="group relative bg-slate-800 border border-slate-700 hover:border-purple-500 rounded-3xl p-8 transition-all hover:-translate-y-1 hover:shadow-[0_10px_40px_-10px_rgba(168,85,247,0.3)] text-left flex flex-col items-center justify-center min-h-[250px]"
          >
            <div className="bg-purple-500/10 p-5 rounded-2xl text-purple-400 group-hover:scale-110 transition-transform mb-6">
              <Building2 className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Industry Login</h2>
            <p className="text-slate-400 text-center">
              I am a Manufacturer, Distributor, or Healthcare Provider managing supply lines.
            </p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans pb-20 relative">
      
      {/* SCANNER MODAL OVERLAY */}
      {showScanner && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md relative">
            <button onClick={() => setShowScanner(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 bg-slate-100 rounded-full p-2 transition-colors">
              <X className="w-5 h-5"/>
            </button>
            <h3 className="text-xl font-bold text-slate-800 mb-4 text-center">Scan Batch QR Code</h3>
            <p className="text-sm text-slate-500 text-center mb-6">Point your camera at the tracking QR code on the packaging.</p>
            <div className="w-full">
               <QRScannerPlugin onScanSuccess={handleScanSuccess} onScanFailure={() => {}} />
            </div>
          </div>
        </div>
      )}

      {/* MINT SUCCESS QR MODAL OVERLAY */}
      {mintedBatchId && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md relative flex flex-col items-center text-center">
            <button onClick={() => setMintedBatchId(null)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-800 bg-slate-100 rounded-full p-2 transition-colors">
              <X className="w-5 h-5"/>
            </button>
            
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 mb-4">
              <CheckCircle2 className="w-8 h-8"/>
            </div>
            <h3 className="text-2xl font-bold text-slate-800 mb-2">Batch Minted!</h3>
            <p className="text-sm text-slate-500 mb-6">Batch #{mintedBatchId} is now live on the Blockchain. Print this QR code and attach it to the packaging.</p>
            
            <div className="bg-white shadow-xl shadow-slate-200 p-4 rounded-3xl border border-slate-100 mb-6">
              {/* Pointing to localhost:5173 URL with query parameter via Third-Party QR API */}
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(`${window.location.origin}/?batch=${mintedBatchId}`)}`} 
                alt="Batch QR Code" 
                style={{ width: '220px', height: '220px' }} 
              />
            </div>
            
            <div className="bg-slate-50 border border-slate-200 w-full p-4 rounded-xl flex justify-between items-center text-left">
              <div>
                <span className="block text-xs text-slate-500 font-medium uppercase">Batch ID</span>
                <span className="font-mono font-bold text-lg text-slate-800">{mintedBatchId}</span>
              </div>
              <button className="text-blue-600 text-sm font-semibold hover:underline" onClick={() => setMintedBatchId(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white shadow-sm border-b border-slate-200 py-4 px-8 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <button onClick={() => {
            setView("landing"); 
            setVerifyId(""); 
            setBatchInfo(null);
            // reset url so if we go back we don't automatically trigger verify query param again
            if(window.history.replaceState) window.history.replaceState(null, "", "/");
          }} className="text-slate-400 hover:text-slate-900 transition-colors p-2 hover:bg-slate-100 rounded-full">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-blue-600 w-8 h-8" />
            <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-cyan-500">
              PharmaChain {view === "industry" ? "Portal" : "Verify"}
            </h1>
          </div>
        </div>
        {view === "industry" && (
          <button
            onClick={connectWallet}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md active:scale-95"
          >
            <Wallet className="w-4 h-4" />
            {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect Wallet"}
          </button>
        )}
      </header>

      <main className="max-w-6xl mx-auto py-10 px-4 space-y-12">
        {/* === INDUSTRY VIEW === */}
        {view === "industry" && (
          <>
            {!account ? (
              <div className="flex flex-col items-center justify-center min-h-[40vh] bg-white border border-slate-200 rounded-3xl p-10 text-center shadow-lg">
                <Wallet className="w-16 h-16 text-slate-300 mb-6" />
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Connect Your Web3 Wallet</h2>
                <p className="text-slate-500 max-w-md mb-8">
                  You must connect MetaMask to access the industry portal and interact with the supply chain contract.
                </p>
                <button onClick={connectWallet} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-full shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 text-lg">
                  Connect MetaMask <ArrowRight className="w-5 h-5"/>
                </button>
              </div>
            ) : (
              <>
                {/* Role Status Bar */}
                <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-8 flex flex-col md:flex-row justify-between items-center text-white shadow-xl">
                  <div className="flex items-center gap-4 mb-4 md:mb-0">
                    <div className="bg-white/10 p-4 rounded-full">
                      <User className="w-8 h-8 text-blue-200" />
                    </div>
                    <div>
                      <p className="text-blue-200 text-sm font-semibold uppercase tracking-wider">Assigned Role</p>
                      <h2 className="text-3xl font-bold">{ROLES[role]}</h2>
                    </div>
                  </div>
                  <div className="bg-slate-900/40 border border-white/10 rounded-xl px-5 py-3 text-sm font-mono text-blue-100 flex items-center gap-2 break-all bg-opacity-50">
                    <Wallet className="w-4 h-4 text-blue-300"/> {account}
                  </div>
                </div>

                {role === 0 && (
                  <div className="bg-white rounded-3xl p-8 border border-amber-200 shadow-xl shadow-amber-100 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-2 h-full bg-amber-400"></div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-2">Welcome! Choose Your Industry Role</h3>
                    <p className="text-slate-500 mb-8">Register your connected wallet with a role to begin participating in the supply chain.</p>
                    <div className="grid md:grid-cols-3 gap-6">
                      <button onClick={() => registerRole(1)} className="border-2 border-slate-100 hover:border-blue-500 hover:bg-blue-50 bg-white p-6 rounded-2xl flex flex-col items-center transition-all group">
                        <Pill className="w-10 h-10 text-slate-400 group-hover:text-blue-500 mb-3" />
                        <span className="font-bold text-lg text-slate-800">Manufacturer</span>
                        <span className="text-xs text-slate-500 text-center mt-2">Can mint new medicine batches onto the blockchain.</span>
                      </button>
                      <button onClick={() => registerRole(2)} className="border-2 border-slate-100 hover:border-purple-500 hover:bg-purple-50 bg-white p-6 rounded-2xl flex flex-col items-center transition-all group">
                        <Building2 className="w-10 h-10 text-slate-400 group-hover:text-purple-500 mb-3" />
                        <span className="font-bold text-lg text-slate-800">Distributor</span>
                        <span className="text-xs text-slate-500 text-center mt-2">Handles logistics and ownership transfers.</span>
                      </button>
                      <button onClick={() => registerRole(3)} className="border-2 border-slate-100 hover:border-emerald-500 hover:bg-emerald-50 bg-white p-6 rounded-2xl flex flex-col items-center transition-all group">
                        <CheckCircle2 className="w-10 h-10 text-slate-400 group-hover:text-emerald-500 mb-3" />
                        <span className="font-bold text-lg text-slate-800 text-center">Retailer / Healthcare</span>
                        <span className="text-xs text-slate-500 text-center mt-2">Final destination before reaching the consumer.</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-8">
                   {/* Manufacturer Panel */}
                   {(role === 1) && (
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100 relative">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-blue-100 text-blue-600 rounded-xl">
                          <Settings className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold">Manufacture Batch</h3>
                      </div>
                      <form onSubmit={createBatch} className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Medicine Name</label>
                          <input required value={batchName} onChange={e=>setBatchName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="e.g. Paracetamol 500mg" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Expiry Date</label>
                            <input required type="date" value={expiry} onChange={e=>setExpiry(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Location</label>
                            <input required value={location} onChange={e=>setLocation(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 outline-none transition" placeholder="City, Country" />
                          </div>
                        </div>
                        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors mt-2 shadow-lg shadow-blue-600/20">
                          Mint Batch & Generate QR
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Transfer Panel */}
                  {(role === 1 || role === 2 || role === 3) && (
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100 relative">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-purple-100 text-purple-600 rounded-xl">
                          <ArrowRight className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold">Transfer Ownership</h3>
                      </div>
                      <form onSubmit={transferBatch} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Batch ID</label>
                            <div className="flex gap-2">
                              <input required type="number" value={transferId} onChange={e=>setTransferId(e.target.value)} className="flex-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition" placeholder="ID" />
                              <button type="button" onClick={() => { setScanTarget("transfer"); setShowScanner(true); }} className="bg-purple-100 hover:bg-purple-200 text-purple-600 p-3 rounded-xl transition-colors">
                                <QrCode className="w-5 h-5" />
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
                            <select value={transferStatus} onChange={e=>setTransferStatus(Number(e.target.value))} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none bg-white">
                              <option value={1}>In Transit</option>
                               <option value={2}>Delivered</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Receiver Address</label>
                          <input required value={transferTo} onChange={e=>setTransferTo(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition" placeholder="0x..." />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Current Location</label>
                          <input required value={transferLoc} onChange={e=>setTransferLoc(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition" placeholder="Facility Name, City" />
                        </div>
                        <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-xl transition-colors mt-2 shadow-lg shadow-purple-600/20">
                          Execute Transfer
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* === VERIFY / CUSTOMER VIEW === */}
        {view === "customer" && (
          <div className="bg-slate-900 rounded-3xl shadow-2xl shadow-blue-900/20 overflow-hidden ring-1 ring-slate-800">
            <div className="p-8 md:p-12 relative overflow-hidden">
               <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 opacity-10 blur-[100px] rounded-full"></div>
              <div className="max-w-xl mb-8 relative z-10">
                <h3 className="text-4xl font-extrabold text-white mb-4">Verify Authenticity</h3>
                <p className="text-slate-400 text-lg leading-relaxed">Ensure your medication is genuine at any stage of the journey. Scan the QR code or enter the Batch ID to read its immutable journey directly from the blockchain.</p>
              </div>
              
              <form onSubmit={verifyBatch} className="flex flex-col sm:flex-row gap-4 max-w-lg relative z-10">
                <input required type="number" value={verifyId} onChange={e=>setVerifyId(e.target.value)} className="flex-1 px-6 py-4 rounded-xl border border-slate-700 bg-slate-800/80 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-lg transition-all" placeholder="Enter Batch ID (e.g. 1)" />
                <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white px-8 font-bold text-lg rounded-xl transition-all hover:shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                  Verify
                </button>
                <button type="button" onClick={() => { setScanTarget("verify"); setShowScanner(true); }} className="bg-slate-700 hover:bg-slate-600 text-white p-4 font-bold rounded-xl transition-all flex items-center justify-center border border-slate-600">
                  <QrCode className="w-6 h-6"/>
                </button>
              </form>
            </div>

            {batchInfo && (
              <div className="bg-slate-800 border-t border-slate-700 p-8 md:p-12">
                <div className="flex flex-col lg:flex-row gap-8 justify-between items-start">
                  <div className="flex-1">
                    <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Medicine Detail</p>
                    <h4 className="text-4xl font-bold text-white mb-4">{batchInfo.medicineName}</h4>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2 text-cyan-400 font-medium bg-cyan-400/10 border border-cyan-400/20 px-4 py-1.5 rounded-full text-sm">
                        <CheckCircle2 className="w-4 h-4" /> Authenticity Verified
                      </div>
                      <div className="flex items-center gap-2 text-slate-300 font-medium bg-slate-700 border border-slate-600 px-4 py-1.5 rounded-full text-sm">
                        ID: #{batchInfo.batchId.toString()}
                      </div>
                    </div>
                  </div>

                  <div className="lg:w-[400px] grid grid-cols-2 gap-x-6 gap-y-6 bg-slate-900/50 p-6 rounded-2xl border border-slate-700">
                    <div>
                      <span className="block text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">Current Status</span>
                      <span className="text-white font-medium text-lg">{STATUS[Number(batchInfo.status)]}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">Expiry Date</span>
                      <span className="text-white font-medium text-lg">{batchInfo.expiryDate}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="block text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">Current Owner Address</span>
                      <span className="text-emerald-400 font-mono text-sm break-all">{batchInfo.currentOwner}</span>
                    </div>
                  </div>
                </div>

                {batchHistory.length > 0 && (
                  <div className="mt-12 pt-10 border-t border-slate-700">
                    <h5 className="text-2xl font-bold text-white mb-8 flex items-center gap-2">
                      <ArrowRight className="text-blue-500" /> Transparent Chain of Custody
                    </h5>
                    <div className="space-y-6 relative before:absolute before:inset-0 before:ml-[1.4rem] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-600 before:to-transparent">
                      {batchHistory.map((event, idx) => (
                        <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                          <div className="flex items-center justify-center w-12 h-12 rounded-full border-4 border-slate-800 bg-blue-500 text-slate-100 shadow-[0_0_15px_rgba(59,130,246,0.5)] shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 relative z-10">
                            {idx === 0 ? <Settings className="w-5 h-5"/> : <ArrowRight className="w-5 h-5"/>}
                          </div>
                          
                          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-xl transition-transform hover:-translate-y-1">
                            <div className="flex justify-between items-start mb-3">
                              <span className="text-blue-400 font-bold text-lg">{STATUS[Number(event.status)]}</span>
                              <span className="text-slate-400 text-sm font-medium bg-slate-900 px-3 py-1 rounded-full">{new Date(Number(event.timestamp) * 1000).toLocaleString()}</span>
                            </div>
                            <p className="text-slate-300 mb-2 flex items-center gap-2">
                              <span className="text-slate-500 text-sm">Location:</span> {event.location}
                            </p>
                            <p className="text-emerald-400/80 text-xs font-mono break-all bg-emerald-400/10 p-2 rounded-lg border border-emerald-400/20">
                              <span className="text-slate-500 mb-1 block font-sans font-semibold">Holder Address:</span>
                              {event.to}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
