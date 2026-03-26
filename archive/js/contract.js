document.addEventListener("DOMContentLoaded", () => {
    initContractInteraction();
});

async function initContractInteraction() {
    if (window.ethereum) {
        const web3 = new Web3(window.ethereum);
        await window.ethereum.request({ method: 'eth_requestAccounts' });

        const contractAddress = "0x7d04AF83D3f3A90f1E2eF43ea166D1adbb2Af8dd"; 
        const contractABI = [
            {
                "inputs": [
                    {
                        "internalType": "string",
                        "name": "customerName",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "startAddress",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "deliveryAddress",
                        "type": "string"
                    },
                    {
                        "internalType": "bool",
                        "name": "fragile",
                        "type": "bool"
                    },
                    {
                        "internalType": "bool",
                        "name": "paymentDone",
                        "type": "bool"
                    },
                    {
                        "internalType": "string",
                        "name": "receivedDate",
                        "type": "string"
                    }
                ],
                "name": "addItem",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "anonymous": false,
                "inputs": [
                    {
                        "indexed": false,
                        "internalType": "uint256",
                        "name": "itemId",
                        "type": "uint256"
                    },
                    {
                        "indexed": false,
                        "internalType": "string",
                        "name": "customerName",
                        "type": "string"
                    },
                    {
                        "indexed": false,
                        "internalType": "string",
                        "name": "startAddress",
                        "type": "string"
                    },
                    {
                        "indexed": false,
                        "internalType": "string",
                        "name": "deliveryAddress",
                        "type": "string"
                    },
                    {
                        "indexed": false,
                        "internalType": "bool",
                        "name": "fragile",
                        "type": "bool"
                    },
                    {
                        "indexed": false,
                        "internalType": "bool",
                        "name": "paymentDone",
                        "type": "bool"
                    },
                    {
                        "indexed": false,
                        "internalType": "string",
                        "name": "receivedDate",
                        "type": "string"
                    }
                ],
                "name": "ItemAdded",
                "type": "event"
            },
            {
                "anonymous": false,
                "inputs": [
                    {
                        "indexed": false,
                        "internalType": "uint256",
                        "name": "itemId",
                        "type": "uint256"
                    },
                    {
                        "indexed": false,
                        "internalType": "uint256",
                        "name": "newProgress",
                        "type": "uint256"
                    }
                ],
                "name": "ProgressUpdated",
                "type": "event"
            },
            {
                "inputs": [
                    {
                        "internalType": "uint256",
                        "name": "itemId",
                        "type": "uint256"
                    },
                    {
                        "internalType": "uint256",
                        "name": "newProgress",
                        "type": "uint256"
                    }
                ],
                "name": "updateProgress",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [
                    {
                        "internalType": "uint256",
                        "name": "itemId",
                        "type": "uint256"
                    }
                ],
                "name": "getItem",
                "outputs": [
                    {
                        "internalType": "string",
                        "name": "customerName",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "startAddress",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "deliveryAddress",
                        "type": "string"
                    },
                    {
                        "internalType": "bool",
                        "name": "fragile",
                        "type": "bool"
                    },
                    {
                        "internalType": "bool",
                        "name": "paymentDone",
                        "type": "bool"
                    },
                    {
                        "internalType": "string",
                        "name": "receivedDate",
                        "type": "string"
                    },
                    {
                        "internalType": "uint256",
                        "name": "progress",
                        "type": "uint256"
                    }
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "itemCount",
                "outputs": [
                    {
                        "internalType": "uint256",
                        "name": "",
                        "type": "uint256"
                    }
                ],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "inputs": [
                    {
                        "internalType": "uint256",
                        "name": "",
                        "type": "uint256"
                    }
                ],
                "name": "items",
                "outputs": [
                    {
                        "internalType": "string",
                        "name": "customerName",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "startAddress",
                        "type": "string"
                    },
                    {
                        "internalType": "string",
                        "name": "deliveryAddress",
                        "type": "string"
                    },
                    {
                        "internalType": "bool",
                        "name": "fragile",
                        "type": "bool"
                    },
                    {
                        "internalType": "bool",
                        "name": "paymentDone",
                        "type": "bool"
                    },
                    {
                        "internalType": "string",
                        "name": "receivedDate",
                        "type": "string"
                    },
                    {
                        "internalType": "uint256",
                        "name": "progress",
                        "type": "uint256"
                    }
                ],
                "stateMutability": "view",
                "type": "function"
            }
        ];

        const contract = new web3.eth.Contract(contractABI, contractAddress);

        window.contract = contract; 
        window.web3 = web3; 
    } else {
        alert("Please install MetaMask!");
    }
}

window.addItem = async function(event) {
    event.preventDefault();
    const customerName = document.getElementById("customerName").value;
    const startAddress = document.getElementById("startAddress").value;
    const deliveryAddress = document.getElementById("deliveryAddress").value;
    const fragile = document.getElementById("fragile").checked;
    const payment = document.getElementById("payment").checked;
    const receivedDate = document.getElementById("receivedDate").value;

    if (!window.contract) {
        alert("Contract not initialized. Please try again.");
        return;
    }

    try {
        const accounts = await window.web3.eth.getAccounts();
        const tx = await window.contract.methods.addItem(customerName, startAddress, deliveryAddress, fragile, payment, receivedDate)
            .send({ from: accounts[0], gas: 300000 });

        const itemId = (await window.contract.methods.itemCount().call()).toNumber();
        const item = await window.contract.methods.getItem(itemId).call();

        const mainDisplay = document.getElementById("mainDisplay");
        const div = document.createElement("div");
        div.classList.add("item");
        div.innerHTML = `
            <h3>${item.customerName}</h3>
            <p><strong>Starting Address:</strong> ${item.startAddress}</p>
            <p><strong>Delivery Address:</strong> ${item.deliveryAddress}</p>
            <p><strong>Fragile:</strong> ${item.fragile}</p>
            <p><strong>Payment:</strong> ${item.paymentDone ? "Done" : "Pending"}</p>
            <p><strong>Package Received Date:</strong> ${item.receivedDate}</p>
            <button class="item-details-btn" onclick='viewItemDetails(${itemId})'>View Details</button>
        `;
        mainDisplay.appendChild(div);

        const progressBarContainer = document.getElementById("progressBarContainer");
        const progressBar = document.createElement("div");
        progressBar.classList.add("progress-bar");
        progressBar.innerHTML = `
            <h3>${item.customerName}</h3>
            <div class="progress" id="progress-${itemId}" style="width: ${item.progress}%"></div>
            <button class="update-btn" onclick='openPopupForm(${itemId})'>Update Progress</button>
        `;
        progressBarContainer.appendChild(progressBar);

        closeForm();
    } catch (error) {
        console.error("Error adding item:", error.message || error);
        alert("Failed due to Browser/Wallet error.");
    }
};

window.updateProgressBar = async function() {
    const itemId = document.getElementById("popupForm").dataset.itemId;
    const selectedStatus = document.querySelector('input[name="status"]:checked');
    if (selectedStatus) {
        const progressValue = selectedStatus.value;

        try {
            const accounts = await window.web3.eth.getAccounts();
            const tx = await window.contract.methods.updateProgress(itemId, progressValue)
                .send({ from: accounts[0], gas: 3000000 }); 

            const progressBar = document.getElementById(`progress-${itemId}`);
            progressBar.style.width = `${progressValue}%`;

            closePopupForm();
        } catch (error) {
            console.error("Error updating progress:", error);
            alert("Failed to update progress. Check console for details.");
        }
    } else {
        alert("Please select a status.");
    }
};

window.viewItemDetails = async function(itemId) {
    try {
        const item = await window.contract.methods.getItem(itemId).call();
        const itemDetailsContent = document.getElementById("itemDetailsContent");
        itemDetailsContent.innerHTML = `
            <p><strong>Customer Name:</strong> ${item.customerName}</p>
            <p><strong>Starting Address:</strong> ${item.startAddress}</p>
            <p><strong>Delivery Address:</strong> ${item.deliveryAddress}</p>
            <p><strong>Fragile:</strong> ${item.fragile}</p>
            <p><strong>Payment:</strong> ${item.paymentDone ? "Done" : "Pending"}</p>
            <p><strong>Package Received Date:</strong> ${item.receivedDate}</p>
            <p><strong>Progress:</strong> ${item.progress}%</p>
        `;
        document.getElementById("itemPopup").style.display = "block";
    } catch (error) {
        console.error("Error fetching item details:", error);
        alert("Failed to fetch item details. Check console for details.");
    }
};
