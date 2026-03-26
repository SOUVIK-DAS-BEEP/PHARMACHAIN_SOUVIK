// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract PackageTracking {
    // Define the structure for an item
    struct Item {
        string customerName;
        string startAddress;
        string deliveryAddress;
        bool fragile;
        bool paymentDone;
        string receivedDate;
        uint256 progress; // Progress in percentage
    }

    // Mapping to store items by their unique ID
    mapping(uint256 => Item) public items;
    uint256 public itemCount;

    // Event to log item addition
    event ItemAdded(
        uint256 itemId,
        string customerName,
        string startAddress,
        string deliveryAddress,
        bool fragile,
        bool paymentDone,
        string receivedDate
    );

    // Event to log progress update
    event ProgressUpdated(uint256 itemId, uint256 newProgress);

    // Add a new item
    function addItem(
        string memory customerName,
        string memory startAddress,
        string memory deliveryAddress,
        bool fragile,
        bool paymentDone,
        string memory receivedDate
    ) public {
        itemCount++;
        items[itemCount] = Item({
            customerName: customerName,
            startAddress: startAddress,
            deliveryAddress: deliveryAddress,
            fragile: fragile,
            paymentDone: paymentDone,
            receivedDate: receivedDate,
            progress: 0 // Initialize progress to 0%
        });

        emit ItemAdded(
            itemCount,
            customerName,
            startAddress,
            deliveryAddress,
            fragile,
            paymentDone,
            receivedDate
        );
    }

    // Update the progress of an item
    function updateProgress(uint256 itemId, uint256 newProgress) public {
        require(newProgress <= 100, "Progress must be between 0 and 100");
        Item storage item = items[itemId];
        item.progress = newProgress;

        emit ProgressUpdated(itemId, newProgress);
    }

    // Get the details of an item
    function getItem(uint256 itemId) public view returns (
        string memory customerName,
        string memory startAddress,
        string memory deliveryAddress,
        bool fragile,
        bool paymentDone,
        string memory receivedDate,
        uint256 progress
    ) {
        Item storage item = items[itemId];
        return (
            item.customerName,
            item.startAddress,
            item.deliveryAddress,
            item.fragile,
            item.paymentDone,
            item.receivedDate,
            item.progress
        );
    }
}
