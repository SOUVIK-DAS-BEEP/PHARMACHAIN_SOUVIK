document.addEventListener("DOMContentLoaded", () => {
  const menuIcon = document.querySelector(".menu-icon");
  const nav = document.querySelector("nav");
  const overlay = document.querySelector(".overlay");
  const confirmButton = document.getElementById("confirmButton");

  if (confirmButton) {
    confirmButton.addEventListener("click", updateProgressBar);
  }

  menuIcon.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  overlay.addEventListener("click", () => {
    nav.classList.remove("open");
  });
});

function openForm() {
  document.getElementById("myForm").style.display = "block";
}

function closeForm() {
  document.getElementById("myForm").style.display = "none";
}

function openItemPopup() {
  document.getElementById("itemPopup").style.display = "block";
}

function closeItemPopup() {
  document.getElementById("itemPopup").style.display = "none";
}

function openPopupForm(customerName) {
  document.getElementById("popupForm").style.display = "block";
  document.getElementById("overlay").style.display = "block";
  
  document.getElementById("popupForm").dataset.customerName = customerName;
}

function closePopupForm() {
  document.getElementById("popupForm").style.display = "none";
  document.getElementById("overlay").style.display = "none";
}

function addItem(event) {
  event.preventDefault();

  const customerName = document.getElementById("customerName").value;
  const startAddress = document.getElementById("startAddress").value;
  const deliveryAddress = document.getElementById("deliveryAddress").value;
  const fragile = document.getElementById("fragile").checked ? "Yes" : "No";
  const payment = document.getElementById("payment").checked ? "Done" : "Pending";
  const receivedDate = document.getElementById("receivedDate").value;

  const item = {
      customerName,
      startAddress,
      deliveryAddress,
      fragile,
      payment,
      receivedDate,
  };

  const mainDisplay = document.getElementById("mainDisplay");
  const div = document.createElement("div");
  div.classList.add("item");
  div.innerHTML = `
      <h3>${customerName}</h3>
      <p><strong>Starting Address:</strong> ${startAddress}</p>
      <p><strong>Delivery Address:</strong> ${deliveryAddress}</p>
      <p><strong>Fragile:</strong> ${fragile}</p>
      <p><strong>Payment:</strong> ${payment}</p>
      <p><strong>Package Received Date:</strong> ${receivedDate}</p>
      <button class="item-details-btn" onclick='viewItemDetails(${JSON.stringify(item)})'>View Details</button>
  `;
  mainDisplay.appendChild(div);

  closeForm();

  const progressBarContainer = document.getElementById("progressBarContainer");
  const progressBar = document.createElement("div");
  progressBar.classList.add("progress-bar");
  progressBar.innerHTML = `
      <h3>${customerName}</h3>
      <div class="progress" id="progress-${customerName.replace(/\s/g, "-")}"></div>
      <button class="update-btn" onclick='openPopupForm("${customerName}")'>Update Progress</button>
  `;
  progressBarContainer.appendChild(progressBar);
}

function viewItemDetails(item) {
  const itemDetailsContent = document.getElementById("itemDetailsContent");
  itemDetailsContent.innerHTML = `
      <p><strong>Customer Name:</strong> ${item.customerName}</p>
      <p><strong>Starting Address:</strong> ${item.startAddress}</p>
      <p><strong>Delivery Address:</strong> ${item.deliveryAddress}</p>
      <p><strong>Fragile:</strong> ${item.fragile}</p>
      <p><strong>Payment:</strong> ${item.payment}</p>
      <p><strong>Package Received Date:</strong> ${item.receivedDate}</p>
  `;
  openItemPopup();
}

function updateProgressBar() {
  const customerName = document.getElementById("popupForm").dataset.customerName;
  const progressBar = document.getElementById(`progress-${customerName.replace(/\s/g, "-")}`);
  
  const selectedStatus = document.querySelector('input[name="status"]:checked');
  if (selectedStatus) {
    const progressValue = selectedStatus.value;
    progressBar.style.width = `${progressValue}%`;
  } else {
    alert("Please select a status.");
  }
  
  closePopupForm();
}
