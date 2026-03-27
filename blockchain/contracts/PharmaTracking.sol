// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PharmaTracking {
    enum Role { None, Manufacturer, Distributor, Retailer }
    enum Status { Manufactured, InTransit, Delivered, Recalled, Sold, Lost, Rejected }

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

    mapping(address => Role) public users;
    mapping(string => Batch) public batches;
    mapping(string => HistoryItem[]) public batchHistory;
    mapping(address => uint256) public deviationCount;
    mapping(address => uint256) public totalTransfersHandled;

    event UserRegistered(address indexed user, Role role);
    event BatchCreated(string batchId, string medicineName, address indexed manufacturer);
    event BatchTransferred(string batchId, address indexed from, address indexed to, Status status);
    event BatchRecalled(string batchId, address indexed recalledBy, string reason);
    event BatchRejected(string batchId, address indexed rejectedBy, string reason);
    event BatchSold(string batchId, address indexed soldBy);
    event BatchLost(string batchId, address indexed reportedBy, string reason);
    event BatchDeactivated(string batchId, Status terminalStatus, address indexed deactivatedBy, string reason);
    event RouteDeviation(string batchId, address expected, address actual, address indexed sender);
    event FraudAlert(string batchId, uint256 scanCount, address scanner);

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
            expectedRetailer: _expectedRetailer
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

        if (deviated) {
            deviationCount[msg.sender]++;
            address expected = users[_to] == Role.Distributor
                ? batches[_batchId].expectedDistributor
                : batches[_batchId].expectedRetailer;
            emit RouteDeviation(_batchId, expected, _to, msg.sender);
        }

        totalTransfersHandled[msg.sender]++;
        // ── End Route Compliance ────────────────────────────────────

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

    function getMyRole() public view returns (Role) {
        return users[msg.sender];
    }

    // ── Active supply chain queries ───────────────────────────────────
    function isBatchActive(string memory _batchId) public view returns (bool) {
        if (!batches[_batchId].exists) return false;
        Status s = batches[_batchId].status;
        return (s != Status.Recalled && s != Status.Lost && s != Status.Rejected);
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
}
