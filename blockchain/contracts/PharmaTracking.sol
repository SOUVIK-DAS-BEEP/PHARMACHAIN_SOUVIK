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

    mapping(address => Role) public users;
    mapping(string => Batch) public batches;
    mapping(string => HistoryItem[]) public batchHistory;
    mapping(string => string[]) public subBatchIds; // parent -> children

    event UserRegistered(address indexed user, Role role);
    event BatchCreated(string batchId, string medicineName, address indexed manufacturer);
    event BatchTransferred(string batchId, address indexed from, address indexed to, Status status);
    event BatchRecalled(string batchId, address indexed recalledBy, string reason);
    event BatchRejected(string batchId, address indexed rejectedBy, string reason);
    event BatchSold(string batchId, address indexed soldBy);
    event BatchLost(string batchId, address indexed reportedBy, string reason);
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
    function createBatch(string memory _batchId, string memory _medicineName, string memory _expiryDate, string memory _location) public onlyRole(Role.Manufacturer) {
        require(!batches[_batchId].exists, "Batch ID already exists");
        batchCount++;
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
        require(batches[_batchId].status != Status.Sold, "Fraud Alert: Batch already sold");

        address previousOwner = batches[_batchId].currentOwner;

        batches[_batchId].currentOwner = _to;
        batches[_batchId].status = _newStatus;
        batches[_batchId].location = _location;

        batchHistory[_batchId].push(HistoryItem({
            from: previousOwner,
            to: _to,
            timestamp: block.timestamp,
            status: _newStatus,
            location: _location,
            notes: ""
        }));

        emit BatchTransferred(_batchId, previousOwner, _to, _newStatus);
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
        
        batches[_batchId].status = Status.Recalled;

        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: batches[_batchId].currentOwner,
            timestamp: block.timestamp,
            status: Status.Recalled,
            location: batches[_batchId].location,
            notes: _reason
        }));

        emit BatchRecalled(_batchId, msg.sender, _reason);
    }

    // ── Report Lost/Damaged ────────────────────────────────────────────
    function reportLost(string memory _batchId, string memory _reason) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender || msg.sender == owner, "Only current owner or admin can report lost");

        batches[_batchId].status = Status.Lost;

        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: address(0), // No owner assumes control after loss
            timestamp: block.timestamp,
            status: Status.Lost,
            location: batches[_batchId].location,
            notes: _reason
        }));

        emit BatchLost(_batchId, msg.sender, _reason);
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
}
