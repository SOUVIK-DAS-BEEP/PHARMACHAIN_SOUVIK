// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PharmaTracking {
    enum Role { None, Manufacturer, Distributor, Retailer }
    enum Status { Manufactured, InTransit, Delivered }

    struct Batch {
        uint256 batchId;
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
    }

    mapping(address => Role) public users;
    mapping(uint256 => Batch) public batches;
    mapping(uint256 => HistoryItem[]) public batchHistory;

    uint256 public batchCount;

    event UserRegistered(address indexed user, Role role);
    event BatchCreated(uint256 indexed batchId, string medicineName, address indexed manufacturer);
    event BatchTransferred(uint256 indexed batchId, address indexed from, address indexed to, Status status);

    modifier onlyRole(Role _role) {
        require(users[msg.sender] == _role, "Unauthorized role");
        _;
    }

    constructor() {
        // Contract deployer gets manufacturer role by default for testing
        users[msg.sender] = Role.Manufacturer;
        emit UserRegistered(msg.sender, Role.Manufacturer);
    }

    // A real production app would restrict user registration to an Admin
    function registerUser(address _user, Role _role) public {
        require(_role != Role.None, "Invalid role");
        users[_user] = _role;
        emit UserRegistered(_user, _role);
    }

    function createBatch(string memory _medicineName, string memory _expiryDate, string memory _location) public onlyRole(Role.Manufacturer) {
        batchCount++;
        batches[batchCount] = Batch({
            batchId: batchCount,
            medicineName: _medicineName,
            timestamp: block.timestamp,
            expiryDate: _expiryDate,
            location: _location,
            manufacturer: msg.sender,
            currentOwner: msg.sender,
            status: Status.Manufactured,
            exists: true
        });

        batchHistory[batchCount].push(HistoryItem({
            from: address(0),
            to: msg.sender,
            timestamp: block.timestamp,
            status: Status.Manufactured,
            location: _location
        }));

        emit BatchCreated(batchCount, _medicineName, msg.sender);
    }

    function transferOwnership(uint256 _batchId, address _to, Status _newStatus, string memory _location) public {
        require(batches[_batchId].exists, "Batch does not exist");
        require(batches[_batchId].currentOwner == msg.sender, "You do not own this batch");
        require(users[_to] != Role.None, "Receiver must have a registered role");

        batches[_batchId].currentOwner = _to;
        batches[_batchId].status = _newStatus;
        batches[_batchId].location = _location;

        batchHistory[_batchId].push(HistoryItem({
            from: msg.sender,
            to: _to,
            timestamp: block.timestamp,
            status: _newStatus,
            location: _location
        }));

        emit BatchTransferred(_batchId, msg.sender, _to, _newStatus);
    }

    function getBatch(uint256 _batchId) public view returns (Batch memory) {
        require(batches[_batchId].exists, "Batch does not exist");
        return batches[_batchId];
    }

    function getBatchHistory(uint256 _batchId) public view returns (HistoryItem[] memory) {
        require(batches[_batchId].exists, "Batch does not exist");
        return batchHistory[_batchId];
    }

    function getMyRole() public view returns (Role) {
        return users[msg.sender];
    }
}
