// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PharmaTracking {
    enum Role { None, Manufacturer, Distributor, Retailer }
    enum Status { Manufactured, InTransit, Delivered, Recalled, Sold, Lost, Rejected, Flagged }
    enum Severity { Info, Warning, Critical }
    struct ScanRecord {
        uint256 totalScans;
        uint256 lastScanTime;
        bool flagged;
    }
    struct Notification {
        uint256 id;
        string batchId;
        string message;
        address triggeredBy;
        uint256 timestamp;
        Severity severity;
        bool read;
    }

    struct Batch {
        string batchId;
        string medicineName;
        uint256 timestamp;
        string expiryDate;
        string location;
        address manufacturer;
        address currentOwner;
        Status status;
        bool exists;
        address expectedDistributor;
        address expectedRetailer;
        string parentBatchId;   // empty for original batches, set for sub-batches
    }

    struct HistoryItem {
        address from;
        address to;
        uint256 timestamp;
        Status status;
        string location;
        string notes;
    }

    address public owner;
    uint256 public batchCount;
    uint256 public activeBatchCount;
    uint256 private _nextNotificationId;
    uint256 public constant SCAN_THRESHOLD = 5;

    mapping(address => Role) public users;
    mapping(string => Batch) public batches;
    mapping(string => HistoryItem[]) public batchHistory;
    mapping(address => uint256) public deviationCount;
    mapping(address => uint256) public totalTransfersHandled;
    mapping(string => string[]) public subBatchIds; // parent -> children

    mapping(address => Notification[]) private userNotifications;
    mapping(string => ScanRecord) public scanRecords;
    mapping(string => uint256) public fakeQrAttempts;

    event UserRegistered(address indexed user, Role role);
    event BatchCreated(string batchId, string medicineName, address indexed manufacturer);
    event BatchTransferred(string batchId, address indexed from, address indexed to, Status status);
    event BatchRecalled(string batchId, address indexed recalledBy, string reason);
    event BatchRejected(string batchId, address indexed rejectedBy, string reason);
    event BatchSold(string batchId, address indexed soldBy);
    event BatchLost(string batchId, address indexed reportedBy, string reason);
    event BatchDeactivated(string batchId, Status terminalStatus, address indexed deactivatedBy, string reason);
    event FakeQrScanned(string attemptedBatchId, address scanner, uint256 timestamp);
    event NotificationCreated(address indexed recipient, uint256 notificationId, string batchId, string message, Severity severity);
    event RouteDeviation(string batchId, address expected, address actual, address indexed sender);
    event BatchFlagged(string batchId, address indexed flaggedBy, string reason);
    event FraudAlert(string batchId, uint256 scanCount, address scanner);
    event BatchSplit(string parentBatchId, string subBatchId, uint256 index, address indexed splitBy);

    // ── Modifiers ──────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Only contract owner");
        _;
    }

    modifier onlyRole(Role _role) {
        require(users[msg.sender] == _role, "Unauthorized role");
        _;
    }

    // ── Constructor ────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
        users[msg.sender] = Role.Manufacturer;
        // Pre-register Hardhat Accounts 1 & 2 for instant Demo
        users[address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8)] = Role.Distributor;
        users[address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC)] = Role.Retailer;
        
        emit UserRegistered(msg.sender, Role.Manufacturer);
        emit UserRegistered(address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8), Role.Distributor);
        emit UserRegistered(address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC), Role.Retailer);
    }

    // ── Admin: Register Users (Public for Demo) ────────────────────────
    function registerUser(address _user, Role _role) public {
        require(_role != Role.None, "Invalid role");
        users[_user] = _role;
        emit UserRegistered(_user, _role);
    }

    // ── Manufacturer: Create Batch ─────────────────────────────────────
    function createBatch(
        string memory _batchId,
        string memory _medicineName,
        string memory _expiryDate,
        string memory _location,
        address _expectedDistributor,
        address _expectedRetailer
    ) public onlyRole(Role.Manufacturer) {
        require(!batches[_batchId].exists, "Batch ID already exists");
        batchCount++;
        activeBatchCount++;
        batches[_batchId] = Batch({
            batchId: _batchId,
            medicineName: _medicineName,
            timestamp: block.timestamp,
            expiryDate: _expiryDate,
            location: _location,
            manufacturer: msg.sender,
            currentOwner: msg.sender,
            status: Status.Manufactured,
            exists: true,
            expectedDistributor: _expectedDistributor,
            expectedRetailer: _expectedRetailer,
            parentBatchId: ""
        });

        batchHistory[_batchId].push(HistoryItem({
            from: address(0),
            to: msg.sender,
            timestamp: block.timestamp,
            status: Status.Manufactured,
            location: _location,
            notes: ""
        }));

        emit BatchCreated(_batchId, _medicineName, msg.sender);
    }

    // ── Transfer Ownership ─────────────────────────────────────────────
    function transferOwnership(string memory _batchId, address _to, Status _newStatus, string memory _location) public {
        require(batches[_batchId].exists, "Batch does not exist");
        // Demo Hack: allow any user to progress the presentation without wallet-swapping
        // require(batches[_batchId].currentOwner == msg.sender, "You do not own this batch");
        require(users[_to] != Role.None, "Receiver must have a registered role");
        require(batches[_batchId].status != Status.Recalled, "Batch has been recalled");
        require(batches[_batchId].status != Status.Lost, "Batch reported as lost");
        require(batches[_batchId].status != Status.Rejected, "Batch has been rejected");
        require(batches[_batchId].status != Status.Flagged, "Batch has been flagged for route deviation");
        require(batches[_batchId].status != Status.Sold, "Fraud Alert: Batch already sold");

        address previousOwner = batches[_batchId].currentOwner;

        // ── Route Compliance Check ──────────────────────────────────
        string memory transferNotes = "";
        bool deviated = false;

        // Check: receiver is Distributor and an expected distributor was assigned
        if (users[_to] == Role.Distributor && batches[_batchId].expectedDistributor != address(0)) {
            if (_to != batches[_batchId].expectedDistributor) {
                deviated = true;
                transferNotes = string(abi.encodePacked(
                    "ROUTE DEVIATION: Expected Distributor 0x",
                    _toHexString(batches[_batchId].expectedDistributor),
                    ", sent to 0x",
                    _toHexString(_to)
                ));
            }
        }

        // Check: receiver is Retailer and an expected retailer was assigned
        if (users[_to] == Role.Retailer && batches[_batchId].expectedRetailer != address(0)) {
            if (_to != batches[_batchId].expectedRetailer) {
                deviated = true;
                transferNotes = string(abi.encodePacked(
                    "ROUTE DEVIATION: Expected Retailer 0x",
                    _toHexString(batches[_batchId].expectedRetailer),
                    ", sent to 0x",
                    _toHexString(_to)
                ));
            }
        }

        totalTransfersHandled[msg.sender]++;

        // Record the transfer first (so history shows where it went)
        batches[_batchId].currentOwner = _to;
        batches[_batchId].status = _newStatus;
        batches[_batchId].location = _location;

        batchHistory[_batchId].push(HistoryItem({
            from: previousOwner,
            to: _to,
            timestamp: block.timestamp,
            status: _newStatus,
            location: _location,
            notes: transferNotes
        }));

        emit BatchTransferred(_batchId, previousOwner, _to, _newStatus);

        // ── Auto-Quarantine on Deviation ─────────────────────────────
        // Transfer is recorded above, now immediately freeze the batch
        if (deviated) {
            deviationCount[msg.sender]++;
            address expected = users[_to] == Role.Distributor
                ? batches[_batchId].expectedDistributor
                : batches[_batchId].expectedRetailer;
            emit RouteDeviation(_batchId, expected, _to, msg.sender);

            // Auto-deactivate: mark as Flagged, no further transfers possible
            batches[_batchId].status = Status.Flagged;
            activeBatchCount--;

            string memory flagNote = string(abi.encodePacked(
                "AUTO-QUARANTINED: Batch frozen due to route deviation. ",
                transferNotes
            ));

            batchHistory[_batchId].push(HistoryItem({
                from: _to,
                to: _to,
                timestamp: block.timestamp,
                status: Status.Flagged,
                location: _location,
                notes: flagNote
            }));

            emit BatchFlagged(_batchId, msg.sender, flagNote);
            emit BatchDeactivated(_batchId, Status.Flagged, msg.sender, flagNote);
        }
        // ── End Route Compliance ────────────────────────────────────
    }

    // ── Helper: address to hex string (for deviation notes) ───────────
    function _toHexString(address _addr) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes20 value = bytes20(_addr);
        bytes memory str = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            str[i * 2] = alphabet[uint8(value[i] >> 4)];
            str[i * 2 + 1] = alphabet[uint8(value[i] & 0x0f)];
        }
        return string(str);
    }

    // ── Split Batch into Sub-Batches ──────────────────────────────────
    function splitBatch(
        string memory _parentBatchId,
        uint256 _count,
        address _receiver,
        string memory _location
    ) public {
        require(batches[_parentBatchId].exists, "Parent batch does not exist");
        require(batches[_parentBatchId].status != Status.Recalled, "Batch has been recalled");
        require(batches[_parentBatchId].status != Status.Lost, "Batch reported as lost");
        require(batches[_parentBatchId].status != Status.Sold, "Fraud Alert: Batch already sold");
        require(_count > 0 && _count <= 50, "Split count must be 1-50");
        require(users[_receiver] != Role.None, "Receiver must have a registered role");

        Batch memory parent = batches[_parentBatchId];

        for (uint256 i = 1; i <= _count; i++) {
            string memory subId = string(abi.encodePacked(_parentBatchId, "-S", _uint2str(i)));

            require(!batches[subId].exists, "Sub-batch ID collision");

            batchCount++;
            batches[subId] = Batch({
                batchId: subId,
                medicineName: parent.medicineName,
                timestamp: block.timestamp,
                expiryDate: parent.expiryDate,
                location: _location,
                manufacturer: parent.manufacturer,
                currentOwner: _receiver,
                status: Status.InTransit,
                exists: true,
                expectedDistributor: parent.expectedDistributor,
                expectedRetailer: parent.expectedRetailer,
                parentBatchId: _parentBatchId
            });

            batchHistory[subId].push(HistoryItem({
                from: msg.sender,
                to: _receiver,
                timestamp: block.timestamp,
                status: Status.InTransit,
                location: _location,
                notes: string(abi.encodePacked("Split from parent batch: ", _parentBatchId))
            }));

            subBatchIds[_parentBatchId].push(subId);

            emit BatchSplit(_parentBatchId, subId, i, msg.sender);
        }
    }

    // ── Retailer: Mark As Sold (Point of Sale) ─────────────────────────
    function markAsSold(string memory _batchId, string memory _location) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].status != Status.Lost, "Batch reported as lost");
        require(batches[_batchId].status != Status.Recalled, "Batch has been recalled");
        require(batches[_batchId].status != Status.Sold, "Fraud Alert: Batch already sold");
        
        batches[_batchId].status = Status.Sold;
        
        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: address(0), 
            timestamp: block.timestamp,
            status: Status.Sold,
            location: _location,
            notes: "Final Sale to Consumer"
        }));

        emit BatchSold(_batchId, msg.sender);
    }

    // ── Recall Batch ───────────────────────────────────────────────────
    function recallBatch(string memory _batchId, string memory _reason) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].manufacturer == msg.sender || msg.sender == owner, "Only manufacturer or owner can recall");
        require(batches[_batchId].status != Status.Recalled, "Batch already recalled");
        require(batches[_batchId].status != Status.Lost, "Batch already lost");
        require(batches[_batchId].status != Status.Rejected, "Batch already rejected");
        
        batches[_batchId].status = Status.Recalled;
        activeBatchCount--;

        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: batches[_batchId].currentOwner,
            timestamp: block.timestamp,
            status: Status.Recalled,
            location: batches[_batchId].location,
            notes: _reason
        }));

        emit BatchRecalled(_batchId, msg.sender, _reason);
        emit BatchDeactivated(_batchId, Status.Recalled, msg.sender, _reason);
    }

    // ── Report Lost/Damaged ────────────────────────────────────────────
    function reportLost(string memory _batchId, string memory _reason) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender || msg.sender == owner, "Only current owner or admin can report lost");
        require(batches[_batchId].status != Status.Recalled, "Batch already recalled");
        require(batches[_batchId].status != Status.Lost, "Batch already lost");
        require(batches[_batchId].status != Status.Rejected, "Batch already rejected");

        batches[_batchId].status = Status.Lost;
        activeBatchCount--;

        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: address(0), // No owner assumes control after loss
            timestamp: block.timestamp,
            status: Status.Lost,
            location: batches[_batchId].location,
            notes: _reason
        }));

        emit BatchLost(_batchId, msg.sender, _reason);
        emit BatchDeactivated(_batchId, Status.Lost, msg.sender, _reason);
    }

    // ── Reject Batch ──────────────────────────────────────────────────
    function rejectBatch(string memory _batchId, string memory _reason) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender || msg.sender == owner, "Only current owner or admin can reject");
        require(batches[_batchId].status != Status.Recalled, "Batch already recalled");
        require(batches[_batchId].status != Status.Lost, "Batch already lost");
        require(batches[_batchId].status != Status.Rejected, "Batch already rejected");

        batches[_batchId].status = Status.Rejected;
        activeBatchCount--;

        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: batches[_batchId].currentOwner,
            timestamp: block.timestamp,
            status: Status.Rejected,
            location: batches[_batchId].location,
            notes: _reason
        }));

        emit BatchRejected(_batchId, msg.sender, _reason);
        emit BatchDeactivated(_batchId, Status.Rejected, msg.sender, _reason);
    }

    // ── Verification GET methods  ──────────────────────────────────────
    function getBatch(string memory _batchId) public view returns (Batch memory) {
        require(batches[_batchId].exists, "Batch does not exist");
        return batches[_batchId];
    }

    function getBatchHistory(string memory _batchId) public view returns (HistoryItem[] memory) {
        require(batches[_batchId].exists, "Batch does not exist");
        return batchHistory[_batchId];
    }

    function getSubBatches(string memory _batchId) public view returns (string[] memory) {
        return subBatchIds[_batchId];
    }

    function getMyRole() public view returns (Role) {
        return users[msg.sender];
    }

    // ── Active supply chain queries ───────────────────────────────────
    function isBatchActive(string memory _batchId) public view returns (bool) {
        if (!batches[_batchId].exists) return false;
        Status s = batches[_batchId].status;
        return (s != Status.Recalled && s != Status.Lost && s != Status.Rejected && s != Status.Flagged);
    }

    function getActiveBatchCount() public view returns (uint256) {
        return activeBatchCount;
    }

    // ── Route compliance queries ──────────────────────────────────────
    function getExpectedRoute(string memory _batchId) public view returns (address expectedDistributor, address expectedRetailer) {
        require(batches[_batchId].exists, "Batch does not exist");
        return (batches[_batchId].expectedDistributor, batches[_batchId].expectedRetailer);
    }

    function getDeviationCount(address _user) public view returns (uint256) {
        return deviationCount[_user];
    }

    function getTotalTransfers(address _user) public view returns (uint256) {
        return totalTransfersHandled[_user];
    }

    // ── Internal Helpers ──────────────────────────────────────────────
    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 j = _i;
        uint256 length;
        while (j != 0) { length++; j /= 10; }
        bytes memory bstr = new bytes(length);
        uint256 k = length;
        while (_i != 0) { k--; bstr[k] = bytes1(uint8(48 + _i % 10)); _i /= 10; }
        return string(bstr);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ── NOTIFICATIONS & ALERTS ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════
    function _notify(address _recipient, string memory _batchId, string memory _msg, Severity _sev) internal {
        if (_recipient == address(0)) return;
        _nextNotificationId++;
        userNotifications[_recipient].push(Notification(_nextNotificationId, _batchId, _msg, msg.sender, block.timestamp, _sev, false));
        emit NotificationCreated(_recipient, _nextNotificationId, _batchId, _msg, _sev);
    }

    function _notifyChain(string memory _batchId, address _mfr, address _actor, string memory _msg, Severity _sev) internal {
        _notify(_mfr, _batchId, _msg, _sev);
        if (_actor != _mfr && _actor != address(0)) _notify(_actor, _batchId, _msg, _sev);
    }

    // ═══════════════════════════════════════════════════════════════════
    // ── SCAN TRACKING & FRAUD DETECTION ───────────────────────────────
    // ═══════════════════════════════════════════════════════════════════
    function recordScan(string memory _batchId) public {
        require(batches[_batchId].exists, "Not found");
        ScanRecord storage rec = scanRecords[_batchId];
        rec.totalScans++;
        rec.lastScanTime = block.timestamp;

        if (rec.totalScans >= SCAN_THRESHOLD && !rec.flagged) {
            rec.flagged = true;
            string memory m = string(abi.encodePacked("FRAUD WARNING: Batch ", _batchId, " scanned ", _uint2str(rec.totalScans), " times! Possible counterfeit duplication."));
            _notify(batches[_batchId].manufacturer, _batchId, m, Severity.Critical);
            emit FraudAlert(_batchId, rec.totalScans, msg.sender);
        }
    }

    function reportFakeQR(string memory _fakeBatchId) public {
        require(!batches[_fakeBatchId].exists, "Batch exists");
        fakeQrAttempts[_fakeBatchId]++;
        string memory m = string(abi.encodePacked("COUNTERFEIT QR ALERT: Non-existent batch ", _fakeBatchId, " was scanned. Attempts: ", _uint2str(fakeQrAttempts[_fakeBatchId])));
        _notify(owner, _fakeBatchId, m, Severity.Critical);
        emit FakeQrScanned(_fakeBatchId, msg.sender, block.timestamp);
    }

    function getScanRecord(string memory _batchId) public view returns (uint256, uint256, bool) {
        ScanRecord storage r = scanRecords[_batchId];
        return (r.totalScans, r.lastScanTime, r.flagged);
    }

    // ── Notification GETs ─────────────────────────────────────────────
    function getMyNotifications() public view returns (Notification[] memory) { return userNotifications[msg.sender]; }
    
    function getUnreadCount() public view returns (uint256) {
        uint256 c = 0;
        Notification[] storage n = userNotifications[msg.sender];
        for (uint i = 0; i < n.length; i++) { if (!n[i].read) c++; }
        return c;
    }

    function markNotificationRead(uint256 _nid) public {
        Notification[] storage n = userNotifications[msg.sender];
        for (uint i = 0; i < n.length; i++) {
            if (n[i].id == _nid) { n[i].read = true; return; }
        }
    }

    function markAllRead() public {
        Notification[] storage n = userNotifications[msg.sender];
        for (uint i = 0; i < n.length; i++) { n[i].read = true; }
    }

}
