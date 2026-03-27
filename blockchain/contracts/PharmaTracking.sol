// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PharmaTracking {
    enum Role { None, Manufacturer, Distributor, Retailer }
    enum Status { Manufactured, InTransit, Delivered, Recalled, Sold, Lost, Rejected }

    // ── Notification severity levels ──────────────────────────────────
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

    // ── On-chain Notification ─────────────────────────────────────────
    struct Notification {
        uint256 id;
        string batchId;
        string message;
        address triggeredBy;
        uint256 timestamp;
        Severity severity;
        bool read;
    }

    address public owner;
    uint256 public batchCount;
    uint256 private _nextNotificationId;

    mapping(address => Role) public users;
    mapping(string => Batch) public batches;
    mapping(string => HistoryItem[]) public batchHistory;

    // ── Notifications per address ─────────────────────────────────────
    mapping(address => Notification[]) private userNotifications;

    event UserRegistered(address indexed user, Role role);
    event BatchCreated(string batchId, string medicineName, address indexed manufacturer);
    event BatchTransferred(string batchId, address indexed from, address indexed to, Status status);
    event BatchRecalled(string batchId, address indexed recalledBy, string reason);
    event BatchRejected(string batchId, address indexed rejectedBy, string reason);
    event BatchSold(string batchId, address indexed soldBy);
    event BatchLost(string batchId, address indexed reportedBy, string reason);
    event FraudAlert(string batchId, uint256 scanCount, address scanner);

    // ── New notification event ────────────────────────────────────────
    event NotificationCreated(address indexed recipient, uint256 notificationId, string batchId, string message, Severity severity);

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

    // ── Internal: Push notification to a user ─────────────────────────
    function _pushNotification(address _to, string memory _batchId, string memory _message, Severity _severity) internal {
        uint256 nId = _nextNotificationId++;
        userNotifications[_to].push(Notification({
            id: nId,
            batchId: _batchId,
            message: _message,
            triggeredBy: msg.sender,
            timestamp: block.timestamp,
            severity: _severity,
            read: false
        }));
        emit NotificationCreated(_to, nId, _batchId, _message, _severity);
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
            exists: true
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
        require(users[_to] != Role.None, "Receiver must have a registered role");
        require(batches[_batchId].status != Status.Recalled, "Batch has been recalled");
        require(batches[_batchId].status != Status.Lost, "Batch reported as lost");

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

        // ── Notify the receiver about incoming batch ──────────────────
        string memory transferMsg = string(abi.encodePacked(
            "Batch ", _batchId, " (",  batches[_batchId].medicineName, ") transferred to you. Status: ",
            _newStatus == Status.InTransit ? "In Transit" : "Delivered"
        ));
        _pushNotification(_to, _batchId, transferMsg, Severity.Info);

        // ── Notify the previous owner that their batch moved ──────────
        string memory senderMsg = string(abi.encodePacked(
            "Batch ", _batchId, " successfully sent to ", _newStatus == Status.InTransit ? "transit" : "delivery"
        ));
        _pushNotification(previousOwner, _batchId, senderMsg, Severity.Info);

        emit BatchTransferred(_batchId, previousOwner, _to, _newStatus);
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

        // ── Notify the current holder that the batch was recalled ─────
        address currentHolder = batches[_batchId].currentOwner;
        string memory recallMsg = string(abi.encodePacked(
            "RECALL ALERT: Batch ", _batchId, " (", batches[_batchId].medicineName, ") has been recalled. Reason: ", _reason
        ));
        _pushNotification(currentHolder, _batchId, recallMsg, Severity.Critical);

        // ── Also notify the manufacturer if they are not the current holder
        if (currentHolder != batches[_batchId].manufacturer) {
            _pushNotification(batches[_batchId].manufacturer, _batchId, recallMsg, Severity.Critical);
        }

        emit BatchRecalled(_batchId, msg.sender, _reason);
    }

    // ── Report Lost/Damaged ────────────────────────────────────────────
    function reportLost(string memory _batchId, string memory _reason) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender || msg.sender == owner, "Only current owner or admin can report lost");

        address previousOwner = batches[_batchId].currentOwner;
        address manufacturer = batches[_batchId].manufacturer;

        batches[_batchId].status = Status.Lost;

        batchHistory[_batchId].push(HistoryItem({
            from: batches[_batchId].currentOwner,
            to: address(0),
            timestamp: block.timestamp,
            status: Status.Lost,
            location: batches[_batchId].location,
            notes: _reason
        }));

        // ── Notify the manufacturer that a batch was reported lost ────
        string memory lostMsg = string(abi.encodePacked(
            "LOST ALERT: Batch ", _batchId, " (", batches[_batchId].medicineName, ") reported lost/damaged. Reason: ", _reason
        ));
        _pushNotification(manufacturer, _batchId, lostMsg, Severity.Critical);

        // ── Walk the batch history and notify ALL previous holders ────
        HistoryItem[] storage history = batchHistory[_batchId];
        for (uint i = 0; i < history.length - 1; i++) {
            address pastHolder = history[i].to;
            // Skip zero-address, skip manufacturer (already notified), skip current reporter
            if (pastHolder != address(0) && pastHolder != manufacturer && pastHolder != previousOwner) {
                string memory chainMsg = string(abi.encodePacked(
                    "SUPPLY CHAIN ALERT: Batch ", _batchId, " you previously handled was reported LOST. Reason: ", _reason
                ));
                _pushNotification(pastHolder, _batchId, chainMsg, Severity.Warning);
            }
        }

        emit BatchLost(_batchId, msg.sender, _reason);
    }

    // ── Reject Batch (new) ─────────────────────────────────────────────
    function rejectBatch(string memory _batchId, string memory _reason) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender, "Only current holder can reject a batch");

        address manufacturer = batches[_batchId].manufacturer;

        batches[_batchId].status = Status.Rejected;

        batchHistory[_batchId].push(HistoryItem({
            from: msg.sender,
            to: msg.sender,
            timestamp: block.timestamp,
            status: Status.Rejected,
            location: batches[_batchId].location,
            notes: _reason
        }));

        // ── Notify the manufacturer of rejection ──────────────────────
        string memory rejectMsg = string(abi.encodePacked(
            "REJECTED: Batch ", _batchId, " (", batches[_batchId].medicineName, ") was rejected. Reason: ", _reason
        ));
        _pushNotification(manufacturer, _batchId, rejectMsg, Severity.Critical);

        // ── Notify all previous holders in the chain ──────────────────
        HistoryItem[] storage history = batchHistory[_batchId];
        for (uint i = 0; i < history.length - 1; i++) {
            address pastHolder = history[i].to;
            if (pastHolder != address(0) && pastHolder != manufacturer && pastHolder != msg.sender) {
                string memory chainMsg = string(abi.encodePacked(
                    "SUPPLY CHAIN ALERT: Batch ", _batchId, " you previously handled was REJECTED. Reason: ", _reason
                ));
                _pushNotification(pastHolder, _batchId, chainMsg, Severity.Warning);
            }
        }

        emit BatchRejected(_batchId, msg.sender, _reason);
    }

    // ── Notification GET methods ───────────────────────────────────────
    function getMyNotifications() public view returns (Notification[] memory) {
        return userNotifications[msg.sender];
    }

    function getUnreadCount() public view returns (uint256) {
        uint256 count = 0;
        Notification[] storage notes = userNotifications[msg.sender];
        for (uint i = 0; i < notes.length; i++) {
            if (!notes[i].read) count++;
        }
        return count;
    }

    function markNotificationRead(uint256 _notificationId) public {
        Notification[] storage notes = userNotifications[msg.sender];
        for (uint i = 0; i < notes.length; i++) {
            if (notes[i].id == _notificationId) {
                notes[i].read = true;
                return;
            }
        }
        revert("Notification not found");
    }

    function markAllRead() public {
        Notification[] storage notes = userNotifications[msg.sender];
        for (uint i = 0; i < notes.length; i++) {
            notes[i].read = false;
            notes[i].read = true;
        }
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
}
