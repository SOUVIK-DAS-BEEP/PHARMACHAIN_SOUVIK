// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PharmaTracking {
    enum Role { None, Manufacturer, Distributor, Retailer }
    enum Status { Manufactured, InTransit, Delivered, Recalled, Sold, Lost, Rejected }
    enum Severity { Info, Warning, Critical }

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
    }

    struct HistoryItem {
        address from;
        address to;
        uint256 timestamp;
        Status status;
        string location;
        string notes;
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

    struct ScanRecord {
        uint256 totalScans;
        uint256 lastScanTime;
        bool flagged;
    }

    address public owner;
    uint256 public batchCount;
    uint256 private _nextNotificationId;
    uint256 public constant SCAN_THRESHOLD = 10;

    mapping(address => Role) public users;
    mapping(string => Batch) public batches;
    mapping(string => HistoryItem[]) public batchHistory;
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
    event FraudAlert(string batchId, uint256 scanCount, address scanner);
    event FakeQrScanned(string attemptedBatchId, address scanner, uint256 timestamp);
    event NotificationCreated(address indexed recipient, uint256 notificationId, string batchId, string message, Severity severity);

    modifier onlyOwner() { require(msg.sender == owner, "Only owner"); _; }
    modifier onlyRole(Role _role) { require(users[msg.sender] == _role, "Unauthorized"); _; }

    constructor() {
        owner = msg.sender;
        users[msg.sender] = Role.Manufacturer;
        users[address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8)] = Role.Distributor;
        users[address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC)] = Role.Retailer;
        emit UserRegistered(msg.sender, Role.Manufacturer);
        emit UserRegistered(address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8), Role.Distributor);
        emit UserRegistered(address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC), Role.Retailer);
    }

    function _notify(address _to, string memory _batchId, string memory _msg, Severity _sev) internal {
        uint256 nId = _nextNotificationId++;
        userNotifications[_to].push(Notification(nId, _batchId, _msg, msg.sender, block.timestamp, _sev, false));
        emit NotificationCreated(_to, nId, _batchId, _msg, _sev);
    }

    function _notifyChain(string memory _batchId, address _skipA, address _skipB, string memory _msg, Severity _sev) internal {
        HistoryItem[] storage h = batchHistory[_batchId];
        for (uint i = 0; i < h.length; i++) {
            address a = h[i].to;
            if (a != address(0) && a != _skipA && a != _skipB) {
                _notify(a, _batchId, _msg, _sev);
            }
        }
    }

    function registerUser(address _user, Role _role) public {
        require(_role != Role.None, "Invalid role");
        users[_user] = _role;
        emit UserRegistered(_user, _role);
    }

    function createBatch(string memory _batchId, string memory _name, string memory _expiry, string memory _loc) public onlyRole(Role.Manufacturer) {
        require(!batches[_batchId].exists, "Exists");
        batchCount++;
        batches[_batchId] = Batch(_batchId, _name, block.timestamp, _expiry, _loc, msg.sender, msg.sender, Status.Manufactured, true);
        batchHistory[_batchId].push(HistoryItem(address(0), msg.sender, block.timestamp, Status.Manufactured, _loc, ""));
        emit BatchCreated(_batchId, _name, msg.sender);
    }

    function transferOwnership(string memory _batchId, address _to, Status _newStatus, string memory _loc) public {
        Batch storage b = batches[_batchId];
        require(b.exists, "Not found");
        require(users[_to] != Role.None, "Unknown receiver");
        require(b.status != Status.Recalled && b.status != Status.Lost, "Blocked");

        address prev = b.currentOwner;
        b.currentOwner = _to;
        b.status = _newStatus;
        b.location = _loc;

        batchHistory[_batchId].push(HistoryItem(prev, _to, block.timestamp, _newStatus, _loc, ""));

        string memory m1 = string(abi.encodePacked("Batch ", _batchId, " (", b.medicineName, ") transferred to you"));
        _notify(_to, _batchId, m1, Severity.Info);
        string memory m2 = string(abi.encodePacked("Batch ", _batchId, " sent successfully"));
        _notify(prev, _batchId, m2, Severity.Info);

        emit BatchTransferred(_batchId, prev, _to, _newStatus);
    }

    function recallBatch(string memory _batchId, string memory _reason) public {
        Batch storage b = batches[_batchId];
        require(b.exists, "Not found");
        require(b.manufacturer == msg.sender || msg.sender == owner, "Not authorized");
        b.status = Status.Recalled;
        batchHistory[_batchId].push(HistoryItem(b.currentOwner, b.currentOwner, block.timestamp, Status.Recalled, b.location, _reason));

        string memory m = string(abi.encodePacked("RECALL: Batch ", _batchId, " recalled. Reason: ", _reason));
        _notify(b.currentOwner, _batchId, m, Severity.Critical);
        if (b.currentOwner != b.manufacturer) _notify(b.manufacturer, _batchId, m, Severity.Critical);

        emit BatchRecalled(_batchId, msg.sender, _reason);
    }

    function reportLost(string memory _batchId, string memory _reason) public {
        Batch storage b = batches[_batchId];
        require(b.exists, "Not found");
        // Demo Hack: allow any user to report without wallet-swapping
        // require(b.currentOwner == msg.sender || msg.sender == owner, "Not authorized");

        address prev = b.currentOwner;
        b.status = Status.Lost;
        batchHistory[_batchId].push(HistoryItem(prev, address(0), block.timestamp, Status.Lost, b.location, _reason));

        string memory m = string(abi.encodePacked("LOST: Batch ", _batchId, " reported lost. Reason: ", _reason));
        _notify(b.manufacturer, _batchId, m, Severity.Critical);
        _notifyChain(_batchId, b.manufacturer, prev, m, Severity.Warning);

        emit BatchLost(_batchId, msg.sender, _reason);
    }

    function rejectBatch(string memory _batchId, string memory _reason) public {
        Batch storage b = batches[_batchId];
        require(b.exists, "Not found");
        // Demo Hack: allow any user to reject without wallet-swapping
        // require(b.currentOwner == msg.sender, "Not holder");

        b.status = Status.Rejected;
        batchHistory[_batchId].push(HistoryItem(msg.sender, msg.sender, block.timestamp, Status.Rejected, b.location, _reason));

        string memory m = string(abi.encodePacked("REJECTED: Batch ", _batchId, " rejected. Reason: ", _reason));
        _notify(b.manufacturer, _batchId, m, Severity.Critical);
        _notifyChain(_batchId, b.manufacturer, msg.sender, m, Severity.Warning);

        emit BatchRejected(_batchId, msg.sender, _reason);
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
            string memory m = string(abi.encodePacked(
                "FRAUD WARNING: Batch ", _batchId, " scanned ", _uint2str(rec.totalScans),
                " times! Possible counterfeit duplication detected."
            ));
            _notify(batches[_batchId].manufacturer, _batchId, m, Severity.Critical);
            if (batches[_batchId].currentOwner != batches[_batchId].manufacturer) {
                _notify(batches[_batchId].currentOwner, _batchId, m, Severity.Warning);
            }
            emit FraudAlert(_batchId, rec.totalScans, msg.sender);
        }
    }

    function reportFakeQR(string memory _fakeBatchId) public {
        require(!batches[_fakeBatchId].exists, "Batch exists");
        fakeQrAttempts[_fakeBatchId]++;
        string memory m = string(abi.encodePacked(
            "COUNTERFEIT QR ALERT: Non-existent batch '", _fakeBatchId,
            "' was scanned. This QR code is FAKE! Attempts: ", _uint2str(fakeQrAttempts[_fakeBatchId])
        ));
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
        revert("Not found");
    }

    function markAllRead() public {
        Notification[] storage n = userNotifications[msg.sender];
        for (uint i = 0; i < n.length; i++) { n[i].read = true; }
    }

    function getBatch(string memory _batchId) public view returns (Batch memory) {
        require(batches[_batchId].exists, "Not found");
        return batches[_batchId];
    }

    function getBatchHistory(string memory _batchId) public view returns (HistoryItem[] memory) {
        require(batches[_batchId].exists, "Not found");
        return batchHistory[_batchId];
    }

    function getMyRole() public view returns (Role) { return users[msg.sender]; }

    function _uint2str(uint256 _i) internal pure returns (string memory) {
        if (_i == 0) return "0";
        uint256 j = _i; uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        while (_i != 0) { len--; b[len] = bytes1(uint8(48 + _i % 10)); _i /= 10; }
        return string(b);
    }
}
