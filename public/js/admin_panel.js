document.addEventListener("DOMContentLoaded", () => {
    loadDashboardSummary();
    loadBookings();

    // Search and filter functionality
    document.getElementById("search-input")?.addEventListener("input", loadBookings);
    document.getElementById("filter-service")?.addEventListener("change", loadBookings);
    document.getElementById("filter-status")?.addEventListener("change", loadBookings);
    document.getElementById("filter-date")?.addEventListener("change", loadBookings);
    document.getElementById("clear-filters")?.addEventListener("click", clearFilters);
});

// ✅ Load dashboard summary
async function loadDashboardSummary() {
    try {
        const res = await fetch("/api/dashboard-summary");
        const data = await res.json();

        document.getElementById("total-bookings").textContent = data.totalBookings || 0;
        document.getElementById("pending-bookings").textContent = data.pendingBookings || 0;
        document.getElementById("completed-bookings").textContent = data.completedBookings || 0;
    } catch (error) {
        console.error("Error loading dashboard summary:", error);
    }
}

// ✅ Load bookings list
async function loadBookings() {
    const search = document.getElementById("search-input")?.value || "";
    const service = document.getElementById("filter-service")?.value || "";
    const status = document.getElementById("filter-status")?.value || "";
    const date = document.getElementById("filter-date")?.value || "";

    try {
        const res = await fetch(`/api/bookings?search=${search}&service=${service}&status=${status}&date=${date}`);
        const data = await res.json();

        const tableBody = document.getElementById("bookings-table-body");
        const recentTable = document.getElementById("recent-bookings-table-body");

        if (!tableBody || !recentTable) return;

        tableBody.innerHTML = "";
        recentTable.innerHTML = "";

        if (data.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="no-data">No bookings found.</td></tr>`;
            return;
        }

        data.forEach((booking) => {
            const statusText = booking.status || "Pending";
            const bookingDate = booking.booking_date ? new Date(booking.booking_date).toLocaleDateString() : "Not Set";

            // Add to main bookings table
            const row = `
            <tr>
                <td>${booking.booking_id}</td>
                <td>${booking.first_name} ${booking.last_name}</td>
                <td>${booking.email || ''}</td>       <!-- ✅ Added Email -->
                <td>${booking.phone_number || ''}</td>   <!-- ✅ New -->
                <td>${booking.address || ''}</td>       <!-- ✅ New -->
                <td>${booking.service_type}</td>
                <td>${bookingDate}</td>
                <td><span class="status-badge ${statusText.toLowerCase()}">${statusText}</span></td>
                <td>
                    <button class="btn small-btn view-btn" onclick="viewBooking(${booking.booking_id})">View</button>
                    <button class="btn small-btn complete-btn" onclick="updateBookingStatus(${booking.booking_id}, 'Completed')">Mark Completed</button>
                </td>
            </tr>
        `;
            tableBody.insertAdjacentHTML("beforeend", row);

            // Add to recent bookings table (limit 5)
            if (recentTable.children.length < 5) {
                const recentRow = `
                    <tr>
                        <td>${booking.first_name} ${booking.last_name}</td>
                        <td>${booking.service_type}</td>
                        <td>${bookingDate}</td>
                        <td><span class="status-badge ${statusText.toLowerCase()}">${statusText}</span></td>
                    </tr>
                `;
                recentTable.insertAdjacentHTML("beforeend", recentRow);
            }
        });
    } catch (error) {
        console.error("Error loading bookings:", error);
    }
}
// log out
function logout() {
    fetch('/logout', { method: 'POST' })
        .then(res => {
            if (res.ok) {
                window.location.href = '/login.html';  // Redirect to login page
            } else {
                alert('Logout failed. Please try again.');
            }
        })
        .catch(err => console.error("Logout error:", err));
}

// ✅ Clear filters
function clearFilters() {
    document.getElementById("search-input").value = "";
    document.getElementById("filter-service").value = "";
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-date").value = "";
    loadBookings();
}

// ✅ View booking details
async function viewBooking(id) {
    try {
        const res = await fetch(`/api/bookings/${id}`);
        const booking = await res.json();

        document.getElementById("modal-booking-id").textContent = booking.booking_id;
        document.getElementById("modal-client-name").textContent = `${booking.first_name} ${booking.last_name}`;
        document.getElementById("modal-client-email").textContent = booking.email;
        document.getElementById("modal-client-phone").textContent = booking.phone_number;
        document.getElementById("modal-client-address").textContent = booking.address;
        document.getElementById("modal-service-type").textContent = booking.service_type;
        document.getElementById("modal-client-message").textContent = booking.message;
        document.getElementById("modal-booking-date").textContent = booking.booking_date || "Not Set";
        document.getElementById("modal-booking-status").textContent = booking.status || "Pending";

        document.getElementById("update-status").value = booking.status || "Pending";
        document.getElementById("booking-details-modal").style.display = "block";
    } catch (error) {
        console.error("Error fetching booking details:", error);
    }
}

// ✅ Update booking status
async function updateBookingStatus(id, newStatus = null) {
    const status = newStatus || document.getElementById("update-status").value;
    try {
        const res = await fetch(`/api/bookings/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
        });
        const result = await res.json();

        if (result.success) {
            alert("Booking status updated successfully.");
            document.getElementById("booking-details-modal").style.display = "none";
            loadDashboardSummary();
            loadBookings();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error("Error updating booking status:", error);
    }
}

// ✅ Close modal
document.querySelector(".close-button").addEventListener("click", () => {
    document.getElementById("booking-details-modal").style.display = "none";
});
