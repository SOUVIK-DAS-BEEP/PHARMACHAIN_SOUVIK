import { useState, useEffect, useEffectEvent, useRef } from "react";
import { ethers } from "ethers";
import { Wallet, ShieldCheck, Settings, ArrowRight, CheckCircle2, User, Building2, Search, ArrowLeft, Pill, QrCode, X, AlertTriangle, ShieldAlert, Bell, Ban, Info, Clock } from "lucide-react";
import { Html5QrcodeScanner } from "html5-qrcode";
import config from "./config.json";

const contractAddress = config.contractAddress;
const contractABI = config.abi;
const WALLET_STORAGE_KEY = "pharmachain.wallet";

const ROLES = { 0: "None", 1: "Manufacturer", 2: "Distributor", 3: "Retailer / Healthcare Provider" };
const STATUS = { 0: "Manufactured", 1: "In Transit", 2: "Delivered", 3: "Recalled", 4: "Sold", 5: "Lost", 6: "Rejected" };
const SEVERITY = { 0: "Info", 1: "Warning", 2: "Critical" };
const SEVERITY_COLORS = {
  0: { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", icon: "text-blue-500", badge: "bg-blue-500" },
  1: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", icon: "text-amber-500", badge: "bg-amber-500" },
  2: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", icon: "text-red-500", badge: "bg-red-500" },
};

// ── Wallet detection via EIP-6963 + legacy fallback ────────────────────────
const getLegacyWalletOptions = () => {
  if (typeof window === "undefined") return [];

  const seen = new Set();
  const options = [];

  const addProvider = (provider) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    const id = provider.isMetaMask ? "metamask" : `wallet-${seen.size}`;
    const label = provider.isMetaMask ? "MetaMask" : "Wallet";
    options.push({ id, label, icon: null, provider });
  };

  const root = window.ethereum;
  if (Array.isArray(root?.providers)) {
    root.providers.forEach(addProvider);
  } else {
    addProvider(root);
  }

  return options;
};

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
  }, [onScanFailure, onScanSuccess]);
  return <div id="qr-reader" className="w-full max-w-sm mx-auto overflow-hidden rounded-xl border-2 border-slate-700"></div>;
};

export default function App() {
  const [view, setView] = useState("landing");
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [role, setRole] = useState(0);
  const [walletName, setWalletName] = useState("Wallet");
  const [selectedWalletId, setSelectedWalletId] = useState(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(WALLET_STORAGE_KEY);
  });

  // Forms mapping
  const [batchName, setBatchName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [location, setLocation] = useState("");
  
  const [transferId, setTransferId] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferStatus, setTransferStatus] = useState(1);
  const [transferLoc, setTransferLoc] = useState("");

  const [retTransferId, setRetTransferId] = useState("");
  const [retTransferTo, setRetTransferTo] = useState("");
  const [retTransferStatus, setRetTransferStatus] = useState(1);
  const [retTransferLoc, setRetTransferLoc] = useState("");

  const [verifyId, setVerifyId] = useState("");
  const [recallId, setRecallId] = useState("");
  const [recallReason, setRecallReason] = useState("");
  const [lostId, setLostId] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [rejectId, setRejectId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [passAuth, setPassAuth] = useState(false);
  const [passKey, setPassKey] = useState("");
  const [batchInfo, setBatchInfo] = useState(null);
  const [batchHistory, setBatchHistory] = useState([]);

  // Modal & QR specific states
  const [mintedBatchId, setMintedBatchId] = useState(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scanTarget, setScanTarget] = useState(""); // "verify" or "transfer"
  const [showWalletPicker, setShowWalletPicker] = useState(false);

  // ── Notification State ──────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifPollRef = useRef(null);
  const notifPanelRef = useRef(null);

  // EIP-6963: modern wallet discovery (MetaMask, Coinbase, etc.)
  const [eip6963Wallets, setEip6963Wallets] = useState([]);
  const eip6963Map = useRef(new Map());
  const connectingRef = useRef(false);

  useEffect(() => {
    const handleAnnounce = (event) => {
      const { info, provider } = event.detail;
      if (eip6963Map.current.has(info.uuid)) return; // already known — skip to prevent re-render loop
      eip6963Map.current.set(info.uuid, {
        id: info.rdns ?? info.uuid,
        label: info.name,
        icon: info.icon ?? null,
        provider,
      });
      setEip6963Wallets([...eip6963Map.current.values()]);
    };
    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", handleAnnounce);
  }, []);

  const runCheckConnection = useEffectEvent(() => {
    checkConnection();
  });

  const runBatchVerification = useEffectEvent((batchId) => {
    verifyBatchId(batchId);
  });

  const runHandleProviderChange = useEffectEvent(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    try {
      setProvider(null);
      setContract(null);
      setAccount("");
      setRole(0);
      await checkConnection();
    } finally {
      connectingRef.current = false;
    }
  });

  // Initial load check for query parameters ?batch=...
  useEffect(() => {
    // Resolve the active provider from EIP-6963 announcements + legacy fallback
    const allOptions = [
      ...eip6963Wallets,
      ...getLegacyWalletOptions().filter(
        (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
      ),
    ];
    const activeWallet = selectedWalletId
      ? allOptions.find((w) => w.id === selectedWalletId) ?? allOptions[0]
      : allOptions[0];
    const injectedProvider = activeWallet?.provider ?? null;

    runCheckConnection();

    injectedProvider?.on?.("chainChanged", runHandleProviderChange);
    injectedProvider?.on?.("accountsChanged", runHandleProviderChange);

    // Auto-Verify if a parameter is present (e.g. they scanned a QR code pointing to localhost/?batch=xyz)
    const urlParams = new URLSearchParams(window.location.search);
    const batchFromUrl = urlParams.get('batch');
    
    if (batchFromUrl) {
      setView("customer");
      setVerifyId(batchFromUrl);
      // Wait a moment for rendering, then run verification
      setTimeout(() => runBatchVerification(batchFromUrl), 1000);
    }

    return () => {
      injectedProvider?.removeListener?.("chainChanged", runHandleProviderChange);
      injectedProvider?.removeListener?.("accountsChanged", runHandleProviderChange);
    };
  }, [selectedWalletId, eip6963Wallets]);

  const checkConnection = async () => {
    // Don't auto-connect if the user explicitly signed out (no stored preference)
    if (typeof window !== "undefined" && !window.localStorage.getItem(WALLET_STORAGE_KEY)) {
      return;
    }

    // Try to find the previously used wallet by stored id
    const storedId = selectedWalletId;

    // Build a merged candidates list: EIP-6963 first, then legacy
    const allOptions = [
      ...eip6963Wallets,
      ...getLegacyWalletOptions().filter(
        (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
      ),
    ];

    const preferred = storedId
      ? allOptions.find((w) => w.id === storedId) ?? allOptions[0]
      : allOptions[0];

    const candidates = preferred ? [preferred, ...allOptions.filter((w) => w !== preferred)] : allOptions;

    for (const wallet of candidates) {
      try {
        const accounts = await wallet.provider.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          setWalletName(wallet.label);
          await connectWallet({ silent: true, injectedProvider: wallet.provider, preferredWallet: wallet.id, walletLabel: wallet.label });
          return;
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  const connectWallet = async ({ silent = false, injectedProvider, preferredWallet, walletLabel } = {}) => {
    // Resolve provider: prefer passed-in, then stored-id lookup, then first available
    if (!injectedProvider) {
      const allOptions = [
        ...eip6963Wallets,
        ...getLegacyWalletOptions().filter(
          (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
        ),
      ];
      const found = preferredWallet
        ? allOptions.find((w) => w.id === preferredWallet)
        : allOptions[0];
      injectedProvider = found?.provider ?? null;
      walletLabel = walletLabel ?? found?.label ?? "Wallet";
    }
    if (!injectedProvider) return alert("Please install an EVM wallet such as MetaMask.");

    const connectedWalletName = walletLabel ?? "Wallet";
    const walletId = preferredWallet ?? "wallet";

    try {
      const accounts = await injectedProvider.request({
        method: silent ? "eth_accounts" : "eth_requestAccounts",
      });

      if (!accounts.length) {
        return;
      }

      setSelectedWalletId(walletId);
      if (typeof window !== "undefined" && walletId) {
        window.localStorage.setItem(WALLET_STORAGE_KEY, walletId);
      }
      setWalletName(connectedWalletName);

      const provider = new ethers.BrowserProvider(injectedProvider);
      const network = await provider.getNetwork();
      
      // Auto-switch network to Hardhat Localhost (Chain ID 31337 / 0x7a69)
      if (Number(network.chainId) !== 31337) {
        try {
          await injectedProvider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x7a69' }], // 31337 in hex
          });
        } catch (switchError) {
          // This error code indicates that the chain has not been added to MetaMask.
          if (switchError.code === 4902) {
            try {
              await injectedProvider.request({
                method: 'wallet_addEthereumChain',
                params: [
                  {
                    chainId: '0x7a69',
                    chainName: 'Hardhat Localhost',
                    rpcUrls: ['http://127.0.0.1:8545'],
                    nativeCurrency: {
                      name: 'Ethereum',
                      symbol: 'ETH',
                      decimals: 18,
                    },
                  },
                ],
              });
            } catch (addError) {
              console.error("Failed to add network:", addError);
            }
          } else {
             console.error("Failed to switch network:", switchError);
          }
        }
      }

      const signer = await provider.getSigner(accounts[0]);
      const addr = await signer.getAddress();
      
      setProvider(provider);
      setAccount(addr);
      
      const pContract = new ethers.Contract(contractAddress, contractABI, signer);
      setContract(pContract);

      try {
        const r = await pContract.getMyRole();
        setRole(Number(r));
      } catch {
        console.log("No role assigned");
      }
    } catch (err) {
      setProvider(null);
      setAccount("");
      setContract(null);
      setRole(0);
      console.error(err);
      if (!silent && err.code !== 4001) {
        alert(err.shortMessage || err.message || "Wallet connection failed.");
      }
    }
  };

  const connectHardhatDemo = async (roleIndex) => {
    try {
      const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
      const accounts = await provider.listAccounts();
      if (!accounts[roleIndex]) throw new Error("Account missing.");
      
      const signer = await provider.getSigner(accounts[roleIndex].address);
      const addr = await signer.getAddress();
      
      setWalletName("Hardhat Demo");
      setProvider(provider);
      setAccount(addr);
      
      const pContract = new ethers.Contract(contractAddress, contractABI, signer);
      setContract(pContract);
      
      try {
        const r = await pContract.getMyRole();
        setRole(Number(r));
      } catch {
        console.log("No role assigned");
      }
      setView("industry");
      setPassAuth(true);
    } catch (e) { console.error(e); alert("Failed Hardhat Demo. Is it running?"); }
  };

  const signOut = async () => {

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(WALLET_STORAGE_KEY);
    }

    setSelectedWalletId(null);
    setProvider(null);
    setAccount("");
    setContract(null);
    setRole(0);
    setWalletName("Wallet");
    setView("landing");
  };

  const walletOptions = [
    ...eip6963Wallets.filter((w) => !w.id.includes("phantom")),
    ...getLegacyWalletOptions().filter(
      (leg) => !eip6963Wallets.some((w) => w.provider === leg.provider)
    ),
  ];

  const openWalletPicker = () => {
    if (walletOptions.length === 1) {
      connectWallet({ injectedProvider: walletOptions[0].provider, preferredWallet: walletOptions[0].id, walletLabel: walletOptions[0].label });
    } else if (walletOptions.length === 0) {
      connectWallet();
    } else {
      setShowWalletPicker(true);
    }
  };

  const ensureLocalNetwork = async () => {
    if (!provider) {
      console.warn("ensureLocalNetwork: provider is null, skipping network check.");
      return true; // Allow transactions via contract signer even if provider ref isn't stored
    }
    try {
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== 31337) {
        alert("⚠️ Wrong Network Detected!\n\nYour MetaMask is currently connected to " + (net.name || "another network") + " instead of Localhost.\n\nPlease open the MetaMask extension, click the network dropdown at the top, and explicitly select 'Localhost 8545' before trying to send a transaction.");
        return false;
      }
    } catch (err) {
      console.warn("ensureLocalNetwork: could not check network, proceeding anyway.", err);
    }
    return true;
  };

  const registerRole = async (selectedRole) => {
    if (!contract || !account) return alert("Please connect wallet first");
    if (!(await ensureLocalNetwork())) return;
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
    if (!(await ensureLocalNetwork())) return;
    try {
      const newId = "BCH-" + crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase().padStart(8, '0');
      const tx = await contract.createBatch(newId, batchName, expiry, location);
      await tx.wait();
      
      setMintedBatchId(newId);
      fetchNotifications();
      
      setBatchName(""); setExpiry(""); setLocation("");
    } catch (err) {
      console.error(err);
      alert(err.code === 4001 ? "Transaction cancelled." : "Error creating batch. Check console for details.");
    }
  };

  const transferBatch = async (e) => {
    e.preventDefault();
    if (!contract) return;
    if (!(await ensureLocalNetwork())) return;
    try {
      const cleanId = transferId.toUpperCase().trim();
      const tx = await contract.transferOwnership(cleanId, transferTo, transferStatus, transferLoc);
      await tx.wait();
      alert("Batch Transfer Recorded Immaculately!");
      fetchNotifications();
      setTransferId(""); setTransferTo(""); setTransferLoc("");
    } catch (err) {
      console.error(err);
      const reason = err.reason ? err.reason : (err.message ? err.message : "Verify you are the current holder.");
      alert(err.code === 4001 ? "Transaction cancelled." : "Error transferring batch:\n" + reason);
    }
  };

  const transferBatchRet = async (e) => {
    e.preventDefault();
    if (!contract) return;
    if (!(await ensureLocalNetwork())) return;
    try {
      const cleanId = retTransferId.toUpperCase().trim();
      const tx = await contract.transferOwnership(cleanId, retTransferTo, retTransferStatus, retTransferLoc);
      await tx.wait();
      alert("Batch Transfer Recorded Immaculately!");
      fetchNotifications();
      setRetTransferId(""); setRetTransferTo(""); setRetTransferLoc("");
    } catch (err) {
      console.error(err);
      const reason = err.reason ? err.reason : (err.message ? err.message : "Verify you are the current holder.");
      alert(err.code === 4001 ? "Transaction cancelled." : "Error transferring batch:\n" + reason);
    }
  };

  const verifyBatchId = async (idToVerify) => {
    if (!idToVerify) return;
    
    // Always use a hardcoded local connection for verification reads,
    // so that even if the MetaMask wallet is mistakenly on Sepolia,
    // reading data won't throw a generic "could not decode result data" (0x collision) error.
    let readContract;
    try {
      const localRpc = "http://127.0.0.1:8545";
      const readProvider = new ethers.JsonRpcProvider(localRpc);
      readContract = new ethers.Contract(contractAddress, contractABI, readProvider);
      
      const code = await readProvider.getCode(contractAddress);
      if (code === "0x" || code === "0x0") {
        throw new Error(`Contract not found on local blockchain at ${contractAddress}. Have you run the hardhat deploy script?`);
      }
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to establish connection to the blockchain.");
      return;
    }

    try {
      const data = await readContract.getBatch(idToVerify);
      if(!data.exists) throw new Error("Batch doesn't exist");
      const history = await readContract.getBatchHistory(idToVerify);
      setBatchInfo(data);
      setBatchHistory(history);
    } catch (err) {
      console.error("Verification failed:", err);
      alert(`Batch ${idToVerify} not found on the active local blockchain.`);
      setBatchInfo(null);
    }
  };

  const verifyBatch = async (e) => {
    e.preventDefault();
    verifyBatchId(verifyId.toUpperCase().trim());
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

  const handleAuth = (e) => {
    e.preventDefault();
    if (passKey === "industry123") {
      setPassAuth(true);
    } else {
      alert("Invalid organization access key.");
    }
  };

  // ── Notification Functions ────────────────────────────────────────────
  const fetchNotifications = async () => {
    if (!contract) return;
    try {
      const notifs = await contract.getMyNotifications();
      const parsed = notifs.map(n => ({
        id: Number(n.id),
        batchId: n.batchId,
        message: n.message,
        triggeredBy: n.triggeredBy,
        timestamp: Number(n.timestamp),
        severity: Number(n.severity),
        read: n.read,
      }));
      // Sort newest first
      parsed.sort((a, b) => b.timestamp - a.timestamp);
      setNotifications(parsed);
      setUnreadCount(parsed.filter(n => !n.read).length);
    } catch (err) {
      console.warn("Could not fetch notifications:", err);
    }
  };

  const markSingleRead = async (notifId) => {
    if (!contract) return;
    try {
      const tx = await contract.markNotificationRead(notifId);
      await tx.wait();
      fetchNotifications();
    } catch (err) {
      console.error("Failed to mark notification read:", err);
    }
  };

  const markAllNotifRead = async () => {
    if (!contract) return;
    try {
      const tx = await contract.markAllRead();
      await tx.wait();
      fetchNotifications();
    } catch (err) {
      console.error("Failed to mark all read:", err);
    }
  };

  // Poll notifications every 5 seconds when connected
  useEffect(() => {
    if (contract && account) {
      fetchNotifications();
      notifPollRef.current = setInterval(fetchNotifications, 5000);
    }
    return () => {
      if (notifPollRef.current) clearInterval(notifPollRef.current);
    };
  }, [contract, account]);

  // Close notification panel on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifPanelRef.current && !notifPanelRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    if (showNotifications) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showNotifications]);

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 2: return <AlertTriangle className="w-5 h-5" />;
      case 1: return <ShieldAlert className="w-5 h-5" />;
      default: return <Info className="w-5 h-5" />;
    }
  };

  const timeAgo = (timestamp) => {
    const seconds = Math.floor(Date.now() / 1000 - timestamp);
    if (seconds < 60) return "Just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(timestamp * 1000).toLocaleDateString();
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
      
      {/* WALLET PICKER MODAL */}
      {showWalletPicker && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowWalletPicker(false)}>
          <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setShowWalletPicker(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-800 bg-slate-100 rounded-full p-2 transition-colors">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-slate-800 mb-2 text-center">Connect Wallet</h3>
            <p className="text-sm text-slate-500 text-center mb-6">Choose a wallet to connect to PharmaChain.</p>
            <div className="flex flex-col gap-3">
              {walletOptions.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => { connectWallet({ injectedProvider: wallet.provider, preferredWallet: wallet.id, walletLabel: wallet.label }); setShowWalletPicker(false); }}
                  className="flex items-center gap-4 w-full rounded-2xl border-2 border-slate-200 hover:border-blue-500 bg-white hover:bg-blue-50 px-5 py-4 transition-all group"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center flex-shrink-0 transition-colors overflow-hidden">
                    {wallet.icon
                      ? <img src={wallet.icon} alt={wallet.label} className="w-7 h-7 object-contain" />
                      : <Wallet className="w-5 h-5 text-slate-600 group-hover:text-blue-600" />}
                  </div>
                  <div className="text-left">
                    <p className="font-semibold text-slate-800">{wallet.label}</p>
                    <p className="text-xs text-slate-400">Connect using {wallet.label}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
            <div className="flex flex-col">
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-cyan-500 leading-none">
                PharmaChain {view === "industry" ? "Portal" : "Verify"}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className={`w-2 h-2 rounded-full ${account ? 'bg-emerald-500' : 'bg-slate-300'} animate-pulse`}></span>
                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400">
                  {account ? `Connected: ${walletName}` : "Not Connected"}
                </span>
              </div>
            </div>
          </div>
        </div>
        {view === "industry" && (
          <div className="flex items-center gap-3">
            {account && (
              <>
                {/* ── Notification Bell ───────────────────────── */}
                <div className="relative" ref={notifPanelRef}>
                  <button
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative p-2.5 rounded-full border border-slate-200 hover:border-blue-400 bg-white hover:bg-blue-50 transition-all group"
                    title="Notifications"
                  >
                    <Bell className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce shadow-lg shadow-red-500/40">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </button>

                  {/* ── Notification Dropdown Panel ────────────── */}
                  {showNotifications && (
                    <div className="absolute right-0 top-14 w-[420px] max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-slate-200 z-[200] overflow-hidden flex flex-col animate-in">
                      {/* Header */}
                      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                        <div className="flex items-center gap-2">
                          <Bell className="w-5 h-5 text-blue-600" />
                          <h3 className="text-lg font-bold text-slate-800">Notifications</h3>
                          {unreadCount > 0 && (
                            <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                              {unreadCount} new
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {unreadCount > 0 && (
                            <button
                              onClick={markAllNotifRead}
                              className="text-xs text-blue-600 hover:text-blue-800 font-semibold hover:underline transition-colors"
                            >
                              Mark all read
                            </button>
                          )}
                          <button
                            onClick={() => setShowNotifications(false)}
                            className="text-slate-400 hover:text-slate-700 p-1 rounded-full hover:bg-slate-100 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Notification List */}
                      <div className="overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-200">
                        {notifications.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                              <Bell className="w-8 h-8 text-slate-300" />
                            </div>
                            <p className="text-slate-500 font-medium">No notifications yet</p>
                            <p className="text-slate-400 text-sm mt-1">Supply chain alerts will appear here when batches are flagged, lost, recalled, or rejected.</p>
                          </div>
                        ) : (
                          notifications.map((notif) => {
                            const colors = SEVERITY_COLORS[notif.severity] || SEVERITY_COLORS[0];
                            return (
                              <div
                                key={notif.id}
                                className={`px-5 py-4 border-b border-slate-100 hover:bg-slate-50/80 transition-colors cursor-pointer ${!notif.read ? 'bg-blue-50/30 border-l-4 border-l-blue-500' : 'border-l-4 border-l-transparent'}`}
                                onClick={() => { if (!notif.read) markSingleRead(notif.id); }}
                              >
                                <div className="flex items-start gap-3">
                                  {/* Severity Icon */}
                                  <div className={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${colors.bg} ${colors.icon} mt-0.5`}>
                                    {getSeverityIcon(notif.severity)}
                                  </div>

                                  {/* Content */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2 mb-1">
                                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} ${colors.border} border`}>
                                        {SEVERITY[notif.severity]}
                                      </span>
                                      <div className="flex items-center gap-1 text-slate-400 shrink-0">
                                        <Clock className="w-3 h-3" />
                                        <span className="text-[10px] font-medium">{timeAgo(notif.timestamp)}</span>
                                      </div>
                                    </div>
                                    <p className={`text-sm leading-snug ${notif.read ? 'text-slate-500' : 'text-slate-800 font-medium'}`}>
                                      {notif.message}
                                    </p>
                                    <div className="flex items-center gap-3 mt-2">
                                      <span className="text-[10px] text-slate-400 font-mono bg-slate-100 px-2 py-0.5 rounded">
                                        {notif.batchId}
                                      </span>
                                      {!notif.read && (
                                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {/* Footer */}
                      {notifications.length > 0 && (
                        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 text-center">
                          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                            {notifications.length} notification{notifications.length !== 1 ? 's' : ''} · Stored on-chain
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <button
                  onClick={signOut}
                  className="border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-full font-medium transition-all"
                >
                  Sign Out
                </button>
              </>
            )}
            <button
              onClick={account ? undefined : openWalletPicker}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-full font-medium transition-all shadow-md active:scale-95"
            >
              <Wallet className="w-4 h-4" />
              {account ? `${account.slice(0, 6)}...${account.slice(-4)}` : "Connect Wallet"}
            </button>
          </div>
        )}
      </header>

      <main className="max-w-6xl mx-auto py-10 px-4 space-y-12">
        {/* === INDUSTRY VIEW === */}
        {view === "industry" && (
          <>
            {!passAuth ? (
              <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <form onSubmit={handleAuth} className="bg-white p-10 rounded-3xl shadow-xl w-full max-w-sm border border-slate-100 text-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500 opacity-5 blur-[50px] rounded-full"></div>
                  <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 relative z-10">
                    <ShieldCheck className="w-8 h-8" />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-800 mb-2 relative z-10">Industry Portal</h2>
                  <p className="text-sm text-slate-500 mb-8 relative z-10">Password: industry123</p>
                  
                  <input
                    type="password"
                    value={passKey}
                    onChange={(e) => setPassKey(e.target.value)}
                    placeholder="Enter access key..."
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all mb-4 text-center tracking-widest text-lg relative z-10"
                  />
                  <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-blue-500/30 relative z-10">
                    Authenticate
                  </button>
                </form>
              </div>
            ) : !account ? (
              <div className="flex flex-col items-center justify-center min-h-[40vh] bg-white border border-slate-200 rounded-3xl p-10 text-center shadow-lg">
                <Wallet className="w-16 h-16 text-slate-300 mb-6" />
                <h2 className="text-2xl font-bold text-slate-800 mb-2">Connect Your Web3 Wallet</h2>
                <p className="text-slate-500 max-w-md mb-8">
                  Connect an EVM wallet such as MetaMask to access the industry portal and interact with the supply chain contract.
                </p>
                <div className="flex w-full max-w-sm flex-col gap-3">
                  {walletOptions.length > 0 ? walletOptions.map((wallet) => (
                    <button
                      key={wallet.id}
                      onClick={() => connectWallet({ injectedProvider: wallet.provider, preferredWallet: wallet.id, walletLabel: wallet.label })}
                      className="flex items-center gap-4 w-full rounded-2xl border-2 border-slate-200 hover:border-blue-500 bg-white hover:bg-blue-50 px-5 py-4 transition-all group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center flex-shrink-0 transition-colors overflow-hidden">
                        {wallet.icon
                          ? <img src={wallet.icon} alt={wallet.label} className="w-7 h-7 object-contain" />
                          : <Wallet className="w-5 h-5 text-slate-600 group-hover:text-blue-600" />}
                      </div>
                      <div className="text-left">
                        <p className="font-semibold text-slate-800">{wallet.label}</p>
                        <p className="text-xs text-slate-400">Connect using {wallet.label}</p>
                      </div>
                    </button>
                  )) : (
                    <button onClick={() => connectWallet()} className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-full shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2 text-lg">
                      <Wallet className="w-5 h-5" />
                      Connect Wallet
                    </button>
                  )}
                  <p className="text-sm text-slate-400 text-center mt-2">
                    {walletOptions.length > 1 ? "Choose the wallet for this session. Sign out any time to switch." : "Install MetaMask if no options appear."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Role Status Bar */}
                <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-8 flex flex-col md:flex-row justify-between items-center text-white shadow-xl relative overflow-hidden">
                  <div className="flex items-center gap-4 mb-4 md:mb-0 relative z-10 w-full md:w-1/3">
                    <div className="bg-white/10 p-4 rounded-full shrink-0">
                      <ShieldCheck className="w-8 h-8 text-blue-200" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-white tracking-wide">Industry Workspace</h2>
                    </div>
                  </div>
                  
                  <div className="flex flex-col lg:flex-row items-center gap-4 relative z-10 w-full lg:w-auto lg:justify-end">
                    {walletName === "Hardhat Demo" && (
                      <div className="flex bg-slate-900/60 rounded-xl p-1.5 border border-white/10 shadow-inner w-full sm:w-auto justify-center">
                        <button onClick={() => connectHardhatDemo(0)} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition flex items-center justify-center min-w-[4rem] ${role===1?'bg-blue-600 text-white shadow-md':'text-slate-400 hover:text-white'}`}>MFR</button>
                        <button onClick={() => connectHardhatDemo(1)} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition flex items-center justify-center min-w-[4rem] ${role===2?'bg-amber-500 text-white shadow-md':'text-slate-400 hover:text-white'}`}>DST</button>
                        <button onClick={() => connectHardhatDemo(2)} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition flex items-center justify-center min-w-[4rem] ${role===3?'bg-emerald-500 text-white shadow-md':'text-slate-400 hover:text-white'}`}>RTL</button>
                      </div>
                    )}
                    
                    <div className="bg-slate-900/50 border border-white/10 rounded-xl px-5 py-3 text-sm font-mono text-blue-200 flex items-center gap-2 justify-center w-full sm:w-auto shrink-0 shadow-inner">
                      <Wallet className="w-4 h-4 text-blue-400 shrink-0"/> {account.slice(0,6)}...{account.slice(-4)}
                    </div>
                    <button onClick={signOut} className="w-full sm:w-auto bg-white/10 hover:bg-white/20 border border-white/20 text-white py-2.5 px-6 rounded-xl font-medium transition flex items-center justify-center gap-2 shrink-0">
                      Sign Out
                    </button>
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

                <div className="grid md:grid-cols-3 gap-8">
                   {/* Manufacturer Panel */}
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

                  {/* Transfer to Distributor Panel */}
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100 relative">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-purple-100 text-purple-600 rounded-xl">
                          <ArrowRight className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold">Transfer to Distributor</h3>
                      </div>
                      <form onSubmit={transferBatch} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Batch ID</label>
                            <div className="flex gap-2">
                              <input required type="text" value={transferId} onChange={e=>setTransferId(e.target.value.toUpperCase().trim())} className="flex-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition" placeholder="e.g. BCH-XYZ" />
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
                          <div className="flex flex-col xl:flex-row gap-2">
                            <input required value={transferTo} onChange={e=>setTransferTo(e.target.value)} className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition w-full" placeholder="0x..." />
                            <select onChange={e => {if(e.target.value) setTransferTo(e.target.value)}} className="w-full xl:w-auto px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none bg-white text-sm text-slate-600">
                              <option value="">Auto-fill Demo...</option>
                              {role === 1 && <option value="0x70997970C51812dc3A010C7d01b50e0d17dc79C8">Account #1 (Distributor)</option>}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Current Location</label>
                          <input required value={transferLoc} onChange={e=>setTransferLoc(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-purple-500 outline-none transition" placeholder="Facility Name, City" />
                        </div>
                        <div className="text-[10px] text-purple-600/70 font-bold uppercase text-center mt-2 tracking-widest">Requires Manufacturer Wallet</div>
                        <button type="submit" className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-xl transition-colors mt-2 shadow-lg shadow-purple-600/20">
                          Transfer
                        </button>
                      </form>
                    </div>

                  {/* Transfer to Retailer Panel */}
                    <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 p-8 border border-slate-100 relative">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
                          <ArrowRight className="w-6 h-6" />
                        </div>
                        <h3 className="text-xl font-bold">Transfer to Retailer</h3>
                      </div>
                      <form onSubmit={transferBatchRet} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Batch ID</label>
                            <div className="flex gap-2">
                              <input required type="text" value={retTransferId} onChange={e=>setRetTransferId(e.target.value.toUpperCase().trim())} className="flex-1 w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition" placeholder="e.g. BCH-XYZ" />
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
                            <select value={retTransferStatus} onChange={e=>setRetTransferStatus(Number(e.target.value))} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none bg-white">
                              <option value={1}>In Transit</option>
                               <option value={2}>Delivered</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Receiver Address</label>
                          <div className="flex flex-col xl:flex-row gap-2">
                            <input required value={retTransferTo} onChange={e=>setRetTransferTo(e.target.value)} className="flex-1 px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition w-full" placeholder="0x..." />
                            <select onChange={e => {if(e.target.value) setRetTransferTo(e.target.value)}} className="w-full xl:w-auto px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none bg-white text-sm text-slate-600">
                              <option value="">Auto-fill Demo...</option>
                              <option value="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC">Account #2 (Retailer)</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-600 mb-1">Current Location</label>
                          <input required value={retTransferLoc} onChange={e=>setRetTransferLoc(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none transition" placeholder="Facility Name, City" />
                        </div>
                        <div className="text-[10px] text-emerald-600/70 font-bold uppercase text-center mt-2 tracking-widest">Requires Distributor Wallet</div>
                        <button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 rounded-xl transition-colors mt-2 shadow-lg shadow-emerald-600/20">
                          Transfer
                        </button>
                      </form>
                    </div>

                </div>

                {/* --- Operational Controls --- */}
                <div className="mt-8 bg-white rounded-3xl p-8 border border-slate-100 shadow-xl shadow-slate-200/50">
                  <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-slate-800">
                    <ShieldCheck className="w-6 h-6 text-red-500" /> Security & Exception Handling
                  </h3>
                  <div className="grid md:grid-cols-3 gap-8">
                    {/* Recall Panel */}
                    <div className="bg-red-50/50 border border-red-100 rounded-2xl p-6">
                      <h4 className="font-bold text-red-700 mb-4 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" /> Recall Sold Batch
                      </h4>
                      <form onSubmit={async (e) => {
                        e.preventDefault();
                        if(!contract) return;
                        if (!(await ensureLocalNetwork())) return;
                        try {
                          const tx = await contract.recallBatch(recallId.toUpperCase().trim(), recallReason);
                          await tx.wait();
                          alert("Batch Recalled successfully. All stakeholders have been notified.");
                          fetchNotifications();
                        } catch (err) { alert("Error recalling batch. Make sure you are the Origin Manufacturer."); console.error(err); }
                      }} className="space-y-4">
                        <input required type="text" placeholder="Batch ID" className="w-full px-4 py-3 rounded-xl border border-red-200 focus:ring-2 focus:ring-red-500 outline-none bg-white" onChange={e=>setRecallId(e.target.value)} />
                        <input required type="text" placeholder="Reason for Recall" className="w-full px-4 py-3 rounded-xl border border-red-200 focus:ring-2 focus:ring-red-500 outline-none bg-white" onChange={e=>setRecallReason(e.target.value)} />
                        <button className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 rounded-xl transition-colors">Initiate Full Recall</button>
                      </form>
                    </div>

                    {/* Report Lost/Destroyed Panel */}
                    <div className="bg-orange-50/50 border border-orange-100 rounded-2xl p-6">
                        <h4 className="font-bold text-orange-700 mb-4 flex items-center gap-2">
                          <ShieldAlert className="w-5 h-5" /> Report Damage / Lost
                        </h4>
                        <form onSubmit={async (e) => {
                          e.preventDefault();
                          if(!contract) return;
                          if (!(await ensureLocalNetwork())) return;
                          try {
                            const tx = await contract.reportLost(lostId.toUpperCase().trim(), lostReason);
                            await tx.wait();
                            alert("Batch status permanently updated to Lost/Destroyed. All previous holders notified.");
                            fetchNotifications();
                          } catch (err) { alert("Error reporting batch. Must be Current Holder."); console.error(err); }
                        }} className="space-y-4">
                          <input required type="text" placeholder="Batch ID" className="w-full px-4 py-3 rounded-xl border border-orange-200 focus:ring-2 focus:ring-orange-500 outline-none bg-white" onChange={e=>setLostId(e.target.value)} />
                          <input required type="text" placeholder="Reason (e.g. Temperature breach)" className="w-full px-4 py-3 rounded-xl border border-orange-200 focus:ring-2 focus:ring-orange-500 outline-none bg-white" onChange={e=>setLostReason(e.target.value)} />
                          <button className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-3 rounded-xl transition-colors">Confirm Incident Details</button>
                        </form>
                    </div>

                    {/* Reject Batch Panel */}
                    <div className="bg-violet-50/50 border border-violet-100 rounded-2xl p-6">
                        <h4 className="font-bold text-violet-700 mb-4 flex items-center gap-2">
                          <Ban className="w-5 h-5" /> Reject Incoming Batch
                        </h4>
                        <form onSubmit={async (e) => {
                          e.preventDefault();
                          if(!contract) return;
                          if (!(await ensureLocalNetwork())) return;
                          try {
                            const tx = await contract.rejectBatch(rejectId.toUpperCase().trim(), rejectReason);
                            await tx.wait();
                            alert("Batch rejected. Manufacturer and all previous holders have been notified.");
                            fetchNotifications();
                            setRejectId(""); setRejectReason("");
                          } catch (err) { 
                            const reason = err.reason || err.message || "Must be the current holder to reject.";
                            alert("Error rejecting batch: " + reason); 
                            console.error(err); 
                          }
                        }} className="space-y-4">
                          <input required type="text" value={rejectId} placeholder="Batch ID" className="w-full px-4 py-3 rounded-xl border border-violet-200 focus:ring-2 focus:ring-violet-500 outline-none bg-white" onChange={e=>setRejectId(e.target.value)} />
                          <input required type="text" value={rejectReason} placeholder="Reason (e.g. Damaged packaging)" className="w-full px-4 py-3 rounded-xl border border-violet-200 focus:ring-2 focus:ring-violet-500 outline-none bg-white" onChange={e=>setRejectReason(e.target.value)} />
                          <button className="w-full bg-violet-600 hover:bg-violet-700 text-white font-medium py-3 rounded-xl transition-colors">Reject & Notify Chain</button>
                        </form>
                    </div>
                  </div>
                </div>

                {/* --- Batch Audit / Verification --- */}
                <div className="mt-8 bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-2xl overflow-hidden relative">
                  <div className="absolute top-0 left-0 w-64 h-64 bg-cyan-500 opacity-5 blur-[100px] rounded-full"></div>
                  <h3 className="text-xl font-bold flex items-center gap-2 mb-6 text-white relative z-10">
                    <Search className="w-6 h-6 text-cyan-400" /> Internal Batch Audit
                  </h3>
                  <form onSubmit={verifyBatch} className="flex gap-4 mb-8 relative z-10">
                    <input required type="text" value={verifyId} onChange={e=>setVerifyId(e.target.value.toUpperCase().trim())} className="flex-1 px-4 py-3 rounded-xl border border-slate-700 bg-slate-800/80 text-white placeholder-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none transition-all" placeholder="Enter Batch ID (e.g. BCH-XYZ) to audit timeline..." />
                    <button type="submit" className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold px-8 py-3 rounded-xl transition-all shadow-lg shadow-cyan-600/30">Audit Tracker</button>
                  </form>
                  
                  {batchInfo && (
                    <div className="border-t border-slate-700 pt-8 mt-8 relative z-10">
                      <div className="flex flex-col lg:flex-row gap-8 justify-between items-start mb-10">
                        <div className="flex-1">
                          <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Internal Record</p>
                          <h4 className="text-4xl font-bold text-white mb-4">{batchInfo.medicineName}</h4>
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2 text-cyan-400 font-medium bg-cyan-400/10 border border-cyan-400/20 px-4 py-1.5 rounded-full text-sm">
                              <CheckCircle2 className="w-4 h-4" /> Validated Entry
                            </div>
                            <div className="flex items-center gap-2 text-slate-300 font-medium bg-slate-700 border border-slate-600 px-4 py-1.5 rounded-full text-sm">
                              ID: #{batchInfo.batchId.toString()}
                            </div>
                          </div>
                        </div>

                        <div className="lg:w-[400px] grid grid-cols-2 gap-x-6 gap-y-6 bg-slate-950/50 p-6 rounded-2xl border border-slate-800">
                          <div>
                            <span className="block text-slate-500 text-xs font-semibold uppercase tracking-wider mb-1">Status</span>
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
                        <div className="pt-2">
                          <h5 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            Immutable Timeline
                          </h5>
                          <div className="flex overflow-x-auto pb-8 pt-4 px-4 snap-x snap-mandatory gap-8 items-center justify-start scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent bg-slate-900/50 rounded-2xl border border-slate-800">
                            {batchHistory.map((event, idx) => {
                              let roleLabel = "System";
                              let roleColor = "text-slate-400";
                              const addr = event.to.toLowerCase();
                              if (addr === "0x70997970c51812dc3a010c7d01b50e0d17dc79c8") { roleLabel = "Distributor"; roleColor="text-amber-400"; }
                              else if (addr === "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc") { roleLabel = "Retailer"; roleColor="text-emerald-400"; }
                              else if (idx === 0) { roleLabel = "Manufacturer"; roleColor="text-blue-400"; }

                              return (
                              <div key={idx} className="relative flex flex-col items-center flex-shrink-0 w-80 snap-center group">
                                {idx !== batchHistory.length - 1 && (
                                  <div className="absolute top-6 left-[50%] w-full h-1 bg-gradient-to-r from-blue-500 to-slate-700 -z-10" />
                                )}
                                
                                <div className="flex items-center justify-center w-14 h-14 rounded-full border-4 border-slate-800 bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.6)] z-10 hover:scale-110 transition-transform">
                                  {idx === 0 ? <Settings className="w-6 h-6"/> : <ArrowRight className="w-6 h-6"/>}
                                </div>
                                
                                <div className="mt-8 bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-xl hover:-translate-y-2 transition-transform w-full relative">
                                  <div className="absolute -top-3 left-[50%] -translate-x-[50%] w-6 h-6 bg-slate-800 border-t border-l border-slate-700 rotate-45 transform"></div>
                                  
                                  <div className="flex justify-between items-start mb-4 relative z-10">
                                    <span className="text-blue-400 font-bold text-lg">{STATUS[Number(event.status)]}</span>
                                    <span className="text-slate-400 text-xs font-medium bg-slate-900 px-3 py-1 rounded-full whitespace-nowrap">{new Date(Number(event.timestamp) * 1000).toLocaleString()}</span>
                                  </div>
                                  
                                  <p className="text-slate-300 mb-4 flex items-center gap-2 relative z-10">
                                    <span className="text-slate-500 text-sm">Location:</span> {event.location}
                                  </p>
                                  
                                  <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700 relative z-10">
                                    <div className="flex justify-between items-center mb-1">
                                      <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Holder:</span>
                                      <span className={`text-xs font-bold uppercase ${roleColor}`}>{roleLabel}</span>
                                    </div>
                                    <p className="text-emerald-400/90 text-xs font-mono break-all leading-relaxed">
                                      {event.to}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )})}
                          </div>
                        </div>
                      )}
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
                <input required type="text" value={verifyId} onChange={e=>setVerifyId(e.target.value.toUpperCase().trim())} className="flex-1 px-6 py-4 rounded-xl border border-slate-700 bg-slate-800/80 text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-lg transition-all" placeholder="Enter Batch ID (e.g. BCH-XYZ)" />
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
                    <div className="flex overflow-x-auto pb-8 pt-4 px-4 snap-x snap-mandatory gap-8 items-center justify-start scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                      {batchHistory.map((event, idx) => {
                        let roleLabel = "System";
                        let roleColor = "text-slate-400";
                        const addr = event.to.toLowerCase();
                        if (addr === "0x70997970c51812dc3a010c7d01b50e0d17dc79c8") { roleLabel = "Distributor"; roleColor="text-amber-400"; }
                        else if (addr === "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc") { roleLabel = "Retailer"; roleColor="text-emerald-400"; }
                        else if (idx === 0) { roleLabel = "Manufacturer"; roleColor="text-blue-400"; }

                        return (
                        <div key={idx} className="relative flex flex-col items-center flex-shrink-0 w-80 snap-center group">
                          {idx !== batchHistory.length - 1 && (
                            <div className="absolute top-6 left-[50%] w-full h-1 bg-gradient-to-r from-blue-500 to-slate-700 -z-10" />
                          )}
                          
                          <div className="flex items-center justify-center w-14 h-14 rounded-full border-4 border-slate-800 bg-blue-600 text-white shadow-[0_0_20px_rgba(37,99,235,0.6)] z-10 hover:scale-110 transition-transform">
                            {idx === 0 ? <Settings className="w-6 h-6"/> : <ArrowRight className="w-6 h-6"/>}
                          </div>
                          
                          <div className="mt-8 bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-xl hover:-translate-y-2 transition-transform w-full relative">
                            <div className="absolute -top-3 left-[50%] -translate-x-[50%] w-6 h-6 bg-slate-800 border-t border-l border-slate-700 rotate-45 transform"></div>
                            
                            <div className="flex justify-between items-start mb-4 relative z-10">
                              <span className="text-blue-400 font-bold text-lg">{STATUS[Number(event.status)]}</span>
                              <span className="text-slate-400 text-xs font-medium bg-slate-900 px-3 py-1 rounded-full whitespace-nowrap">{new Date(Number(event.timestamp) * 1000).toLocaleString()}</span>
                            </div>
                            
                            <p className="text-slate-300 mb-4 flex items-center gap-2 relative z-10">
                              <span className="text-slate-500 text-sm">Location:</span> {event.location}
                            </p>
                            
                            <div className="bg-slate-900/50 p-3 rounded-xl border border-slate-700 relative z-10">
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Holder:</span>
                                <span className={`text-xs font-bold uppercase ${roleColor}`}>{roleLabel}</span>
                              </div>
                              <p className="text-emerald-400/90 text-xs font-mono break-all leading-relaxed">
                                {event.to}
                              </p>
                            </div>
                          </div>
                        </div>
                      )})}
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
