"use strict";

/* ============================================
   CONFIGURATION
============================================ */

const CONFIG = {
    API_ENDPOINT: "https://0n2iuenxuf.execute-api.us-east-1.amazonaws.com/default/advisor",
    ANIMATION_SPEED: 200,
    SCROLL_SPEED: 200
};

/* ============================================
   GLOBAL STATE
============================================ */

let leaderboardBarChart = null;
let budgetChartInstance = null;
let gpaChartInstance = null;

// Advisor rate limiting - track timestamps of calls in this session
let advisorCallTimestamps = [];
const ADVISOR_RATE_LIMIT = 10;
const ADVISOR_RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms

// Store last calculator results for contextual advisor
let lastGpaResult = null;
let lastBudgetResult = null;

/* ============================================
   AUTHENTICATION & SESSION MANAGEMENT
============================================ */

function setAuthState(isLoggedIn) {
    if (isLoggedIn) {
        $('body').addClass('logged-in');
    } else {
        $('body').removeClass('logged-in');
        localStorage.removeItem('token');
    }
}

function checkAuthOnLoad() {
    const token = localStorage.getItem('token');
    if (token && token.trim() !== "") {
        setAuthState(true);
        showSection('div-dashboard');
    } else {
        setAuthState(false);
        showSection('div-login');
    }
}

/* ============================================
   NAVIGATION & UI HELPERS
============================================ */

function showSection(sectionId) {
    // Hide ALL sections first
    $(".content-wrapper").hide();
    
    // Show only the requested section
    $("#" + sectionId).fadeIn(CONFIG.ANIMATION_SPEED);
    
    // Scroll to top
    $("html, body").animate({ scrollTop: 0 }, CONFIG.SCROLL_SPEED);
}

function setMessage(selector, msg, type = "info") {
    const $el = $(selector);
    $el.removeClass().html("");

    if (!msg) return;

    let cls = "alert ";
    if (type === "success") cls += "alert-success";
    else if (type === "error") cls += "alert-danger";
    else if (type === "warning") cls += "alert-warning";
    else cls += "alert-secondary";

    $el.addClass(cls + " text-center fade-in").html(msg);
}

function showLoading(selector) {
    $(selector).html('<div class="text-center"><div class="loading-spinner mx-auto"></div></div>');
}

function clearMessage(selector) {
    $(selector).html("").removeClass();
}

/* ============================================
   AUTH: LOGIN
============================================ */

function loginController() {
    clearMessage("#login_message");

    const username = $("#username").val().trim();
    const password = $("#password").val();

    // Validation
    if (!username) {
        setMessage("#login_message", "Username is required.", "error");
        $("#username").addClass("is-invalid");
        return;
    }

    if (!password) {
        setMessage("#login_message", "Password is required.", "error");
        $("#password").addClass("is-invalid");
        return;
    }

    // Clear validation states
    $("#username, #password").removeClass("is-invalid");

    showLoading("#login_message");

    const data = $("#form-login").serialize();

    $.ajax({
        url: CONFIG.API_ENDPOINT + "/login",
        method: "POST",
        data: data,
        success: (results) => {
            if (Array.isArray(results) && results.length > 0) {
                // Store token
                localStorage.setItem("token", results[0].lasttoken);

                // Set authenticated state
                setAuthState(true);

                // Show success message briefly
                setMessage("#login_message", "Login successful! Redirecting...", "success");

                // Clear form
                $("#username, #password").val("");

                // Redirect to dashboard
                setTimeout(() => {
                    showSection("div-dashboard");
                }, 800);

            } else {
                setMessage("#login_message", "Invalid credentials. Please try again.", "error");
                $("#password").val("").focus();
            }
        },
        error: (xhr) => {
            let msg = "Login failed. Please try again.";
            if (xhr.responseJSON && xhr.responseJSON.message) {
                msg = xhr.responseJSON.message;
            } else if (xhr.responseText) {
                msg = xhr.responseText;
            }

            setMessage("#login_message", msg, "error");
            $("#password").val("").focus();
        }
    });
}

/* ============================================
   AUTH: SIGNUP
============================================ */

function signupController() {
    clearMessage("#signup_message");

    const fname = $("#fname").val().trim();
    const lname = $("#lname").val().trim();
    const username = $("#new_username").val().trim();
    const password = $("#new_password").val();

    // Validation
    if (!fname || !lname || !username || !password) {
        setMessage("#signup_message", "All fields are required.", "error");
        return;
    }

    if (password.length < 6) {
        setMessage("#signup_message", "Password must be at least 6 characters.", "error");
        $("#new_password").addClass("is-invalid");
        return;
    }

    $("#fname, #lname, #new_username, #new_password").removeClass("is-invalid");

    showLoading("#signup_message");

    const data = $("#form-signup").serialize();

    $.ajax({
        url: CONFIG.API_ENDPOINT + "/signup",
        method: "POST",
        data: data,
        success: () => {
            setMessage("#signup_message", "Account created successfully! Redirecting to login...", "success");
            $("#form-signup")[0].reset();

            setTimeout(() => {
                showSection("div-login");
                setMessage("#login_message", "Account created! Please log in.", "success");
            }, 1500);
        },
        error: (xhr) => {
            let msg = "Signup failed. Please try again.";
            if (xhr.responseText) {
                msg = xhr.responseText;
            }
            setMessage("#signup_message", msg, "error");
        }
    });
}

/* ============================================
   AUTH: LOGOUT
============================================ */

async function logoutController() {
    // Only try to cancel game if one was started
    if (gameStartedThisSession) {
        await cancelGameController();
    }

    // Clear session
    localStorage.removeItem("token");
    setAuthState(false);

    // Show login page
    showSection("div-login");
    setMessage("#login_message", "You have been logged out.", "success");
}

/* ============================================
   GAME: START GAME
============================================ */

// Track if a game has been properly started this session
let gameStartedThisSession = false;

function startGameController() {
    const token = localStorage.getItem("token");
    
    if (!token || token.trim() === "") {
        alert("Session expired. Please login again.");
        setAuthState(false);
        showSection("div-login");
        return;
    }

    // Show loading state on dashboard if coming from there
    showLoading("#endgame_message");

    const data = "token=" + encodeURIComponent(token);

    $.ajax({
        url: CONFIG.API_ENDPOINT + "/startgame",
        method: "POST",
        data: data,
        success: (results) => {
            const game = Array.isArray(results) ? results[0] : results;

            // Mark game as properly started
            gameStartedThisSession = true;

            // Populate game UI
            $('#intro').text(game.intro || "Welcome to HuntZilla!");
            $('#q1').text(game.q1 || "Question 1");
            $('#q2').text(game.q2 || "Question 2");
            $('#q3').text(game.q3 || "Question 3");

            // Clear inputs and feedback
            $('#a1, #a2, #a3').val("");
            $('#msg1, #msg2, #msg3').html("").removeClass();
            clearMessage("#endgame_message");

            // Show game section
            showSection("div-game");
        },
        error: (xhr) => {
            let msg = "Failed to start game.";
            let errorData = null;
            
            if (xhr.responseJSON) {
                errorData = xhr.responseJSON;
                msg = errorData.message || errorData.error || msg;
            } else if (xhr.responseText) {
                try {
                    errorData = JSON.parse(xhr.responseText);
                    msg = errorData.message || errorData.error || xhr.responseText;
                } catch (e) {
                    msg = xhr.responseText;
                }
            }

            // Check if it's a token/session issue
            if (msg.toLowerCase().includes("invalid token") || 
                msg.toLowerCase().includes("session") ||
                xhr.status === 401 || xhr.status === 403) {
                // Token is invalid - force re-login
                alert("Your session has expired. Please log in again.");
                setAuthState(false);
                showSection("div-login");
                return;
            }

            alert(msg);
            // Stay on dashboard if game start failed
            showSection("div-dashboard");
        }
    });
}

/* ============================================
   GAME: SUBMIT GUESS
============================================ */

function showGuessResult(selector, msg) {
    const clean = (msg || "").toString().replace(/['"]+/g, "").trim().toLowerCase();
    const display = clean.charAt(0).toUpperCase() + clean.slice(1);

    const $el = $(selector);
    $el.removeClass();

    if (clean.includes("incorrect") || clean.includes("wrong") || clean.includes("fail")) {
        $el.text(display).addClass("game-feedback feedback-incorrect");
    } else if (clean.includes("correct") || clean.includes("right") || clean.includes("success")) {
        $el.text(display).addClass("game-feedback feedback-correct");
    } else {
        $el.text(display).addClass("game-feedback");
    }
}

function submitGuess(questionNum) {
    const token = localStorage.getItem("token");
    const guess = $(`#a${questionNum}`).val().trim();

    if (!token || token.trim() === "") {
        alert("Session expired. Please login again.");
        setAuthState(false);
        showSection("div-login");
        return;
    }

    // Check if game was properly started
    if (!gameStartedThisSession) {
        showGuessResult(`#msg${questionNum}`, "Please start a new game first.");
        setMessage("#endgame_message", "Game session not initialized. Starting new game...", "warning");
        setTimeout(() => {
            startGameController();
        }, 1500);
        return;
    }

    if (!guess) {
        showGuessResult(`#msg${questionNum}`, "Please enter an answer before submitting.");
        return;
    }

    const data = "token=" + encodeURIComponent(token) + "&guess=" + encodeURIComponent(guess);

    $.ajax({
        url: `${CONFIG.API_ENDPOINT}/guess${questionNum}`,
        method: "PATCH",
        data: data,
        success: (results) => {
            const msg = results.result || results.message || results.responsetext || JSON.stringify(results);
            showGuessResult(`#msg${questionNum}`, msg);
        },
        error: (xhr) => {
            let msg = "Error submitting guess.";
            if (xhr.responseJSON && xhr.responseJSON.message) {
                msg = xhr.responseJSON.message;
            } else if (xhr.responseJSON && xhr.responseJSON.error) {
                msg = xhr.responseJSON.error;
            } else if (xhr.responseText) {
                try {
                    const parsed = JSON.parse(xhr.responseText);
                    msg = parsed.message || parsed.error || xhr.responseText;
                } catch (e) {
                    msg = xhr.responseText;
                }
            }

            // Check for token/game session issues
            if (msg.toLowerCase().includes("invalid token") || 
                msg.toLowerCase().includes("no active game") ||
                xhr.status === 401 || xhr.status === 403) {
                
                // Game state is broken - offer to restart
                showGuessResult(`#msg${questionNum}`, "Game session error.");
                setMessage("#endgame_message", 
                    `<i class="fas fa-exclamation-triangle me-2"></i>Game session issue detected. 
                     <button class="btn btn-sm btn-primary ms-2" onclick="startGameController()">
                         <i class="fas fa-redo me-1"></i>Restart Game
                     </button>`, 
                    "warning");
                gameStartedThisSession = false;
                return;
            }

            showGuessResult(`#msg${questionNum}`, msg);
        }
    });
}

/* ============================================
   GAME: END GAME
============================================ */

function fireConfetti() {
    if (typeof confetti !== "function") return;

    confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 }
    });

    setTimeout(() => {
        confetti({
            particleCount: 80,
            spread: 120,
            scalar: 0.9,
            origin: { y: 0.2 }
        });
    }, 300);
}

function endGameController() {
    const token = localStorage.getItem("token");
    
    if (!token || token.trim() === "") {
        setMessage("#endgame_message", "Session expired. Please login again.", "error");
        setAuthState(false);
        showSection("div-login");
        return;
    }

    // Check if game was properly started
    if (!gameStartedThisSession) {
        setMessage("#endgame_message", "No active game session. Please start a new game.", "warning");
        return;
    }

    const data = "token=" + encodeURIComponent(token);

    $.ajax({
        url: CONFIG.API_ENDPOINT + "/endgame",
        method: "POST",
        data: data,
        success: (results) => {
            showSection("div-confirm");

            const msg = (typeof results === "string")
                ? results
                : (results.message || results.responsetext || JSON.stringify(results));

            $('#confirm_message')
                .hide()
                .html(`
                    <img src="images/check_high.png" alt="Success Checkmark"
                         style="display:block; margin-left:auto; margin-right:auto; max-width:80%; height:auto;">
                    <h3 class="mt-3">${msg}</h3>
                `)
                .fadeIn(400);

            fireConfetti();

            // IMPORTANT: Lambda nullifies the token on successful endgame
            // The token is now invalid, but we let user view the page and leaderboard
            // They will be logged out when they click a button to leave
            gameStartedThisSession = false;
        },
        error: (xhr) => {
            let msg = "Error ending game.";
            if (xhr.responseJSON && xhr.responseJSON.message) {
                msg = xhr.responseJSON.message;
            } else if (xhr.responseJSON && xhr.responseJSON.error) {
                msg = xhr.responseJSON.error;
            } else if (xhr.responseText) {
                try {
                    const parsed = JSON.parse(xhr.responseText);
                    msg = parsed.message || parsed.error || xhr.responseText;
                } catch (e) {
                    msg = xhr.responseText;
                }
            }

            // Check for token/game session issues
            if (msg.toLowerCase().includes("invalid token") || 
                msg.toLowerCase().includes("no active game") ||
                xhr.status === 401 || xhr.status === 403) {
                
                gameStartedThisSession = false;
                setMessage("#endgame_message", 
                    `<i class="fas fa-exclamation-triangle me-2"></i>Game session issue. 
                     <button class="btn btn-sm btn-primary ms-2" onclick="startGameController()">
                         <i class="fas fa-redo me-1"></i>Start New Game
                     </button>`, 
                    "warning");
                return;
            }

            if (msg.toLowerCase().includes("keep hunting")) {
                setMessage("#endgame_message", "Not so fast! Keep hunting and answer all questions!", "error");
            } else {
                setMessage("#endgame_message", msg, "error");
            }
        }
    });
}

/* ============================================
   GAME: CANCEL GAME
============================================ */

async function cancelGameController() {
    const token = localStorage.getItem("token");
    
    if (!token || token.trim() === "") {
        gameStartedThisSession = false;
        return { ok: true, skipped: true };
    }

    // If no game was started this session, skip the cancel call
    if (!gameStartedThisSession) {
        return { ok: true, skipped: true, reason: "no_active_game" };
    }

    const qs = "?token=" + encodeURIComponent(token);
    const body = "token=" + encodeURIComponent(token);

    try {
        const response = await fetch(CONFIG.API_ENDPOINT + "/cancelgame" + qs, {
            method: "DELETE",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            keepalive: true,
            body
        });

        let data = null;
        try { 
            data = await response.json(); 
        } catch (e) { 
            // Response might not be JSON
        }

        gameStartedThisSession = false;

        if (response.ok) {
            return { ok: true };
        } else {
            return { ok: false, status: response.status, data };
        }
    } catch (err) {
        gameStartedThisSession = false;
        return { ok: false, error: String(err) };
    }
}

// Cancel game on page unload (only if a game was started this session)
window.addEventListener("beforeunload", function () {
    // Don't send cancel request if no game was started
    if (!gameStartedThisSession) return;
    
    const token = localStorage.getItem("token");
    if (!token || token.trim() === "") return;

    const qs = "?token=" + encodeURIComponent(token);
    const body = "token=" + encodeURIComponent(token);

    try {
        fetch(CONFIG.API_ENDPOINT + "/cancelgame" + qs, {
            method: "DELETE",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            keepalive: true,
            body
        }).catch(() => { });
    } catch (_) { }
});

/* ============================================
   LEADERBOARD
============================================ */

function loadLeaderboard() {
    showLoading("#leaderboard_message");

    $.ajax({
        url: CONFIG.API_ENDPOINT + "/leaderboard",
        method: "GET",
        success: (results) => {
            clearMessage("#leaderboard_message");

            // Show podium
            $("#podiumContainer").fadeIn(300);
            $("#podium1").text(results[0]?.username || "-");
            $("#podium2").text(results[1]?.username || "-");
            $("#podium3").text(results[2]?.username || "-");

            // Destroy existing chart
            if (leaderboardBarChart !== null) {
                leaderboardBarChart.destroy();
            }

            // Create new chart
            const ctx = document.getElementById("leaderboardBarChart").getContext("2d");

            leaderboardBarChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: results.map(r => r.username),
                    datasets: [{
                        label: "Seconds",
                        data: results.map(r => r.seconds),
                        backgroundColor: [
                            "rgba(255, 215, 0, 0.7)",
                            "rgba(192, 192, 192, 0.7)",
                            "rgba(205, 127, 50, 0.7)",
                            "rgba(220, 53, 69, 0.6)",
                            "rgba(220, 53, 69, 0.6)"
                        ],
                        borderColor: [
                            "gold",
                            "silver",
                            "#cd7f32",
                            "rgb(220,53,69)",
                            "rgb(220,53,69)"
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            title: { 
                                display: true, 
                                text: "Seconds",
                                color: '#666'
                            },
                            ticks: {
                                color: '#666'
                            }
                        },
                        y: {
                            ticks: {
                                color: '#666'
                            }
                        }
                    }
                }
            });
        },
        error: () => {
            setMessage("#leaderboard_message", "Error loading leaderboard. Please try again.", "error");
        }
    });
}

/* ============================================
   TOOLS HELPER - CALL LAMBDA ENDPOINTS
============================================ */

/**
 * Helper function to call tools endpoints (GPA, Budget).
 * @param {string} toolName - The tool to call ("gpa" or "budget")
 * @param {object} payload - The data object to send
 * @returns {Promise} - Resolves with the parsed JSON result or rejects with error
 */
function callToolEndpoint(toolName, payload) {
    return new Promise((resolve, reject) => {
        const token = localStorage.getItem("token");
        
        if (!token || token.trim() === "") {
            reject({ message: "Session expired. Please login again.", sessionExpired: true });
            return;
        }

        // Add token to payload
        const dataWithToken = { ...payload, token: token };

        // Convert to URL-encoded string for consistency with other endpoints
        const data = Object.keys(dataWithToken)
            .map(key => encodeURIComponent(key) + "=" + encodeURIComponent(dataWithToken[key]))
            .join("&");

        $.ajax({
            url: CONFIG.API_ENDPOINT + "/" + toolName,
            method: "POST",
            data: data,
            success: (results) => {
                resolve(results);
            },
            error: (xhr) => {
                let msg = "Calculation failed. Please try again.";
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    msg = xhr.responseJSON.message;
                } else if (xhr.responseText) {
                    try {
                        const parsed = JSON.parse(xhr.responseText);
                        msg = parsed.message || msg;
                    } catch (e) {
                        msg = xhr.responseText;
                    }
                }
                reject({ message: msg });
            }
        });
    });
}

/* ============================================
   GPA CALCULATOR
============================================ */

/**
 * Classify the GPA impact based on delta between current and projected GPA.
 * @param {number} currentGpa - The student's current GPA
 * @param {number} projectedGpa - The projected GPA after planned courses
 * @returns {object} - { category, delta, isPositive }
 */
function classifyGpaImpact(currentGpa, projectedGpa) {
    const delta = projectedGpa - currentGpa;
    
    if (delta <= -0.25) {
        return { category: "big_drop", delta, isPositive: false };
    } else if (delta > -0.25 && delta < -0.05) {
        return { category: "small_drop", delta, isPositive: false };
    } else if (delta >= -0.05 && delta < 0.05) {
        return { category: "flat", delta, isPositive: false };
    } else {
        // delta >= 0.05 OR projectedGpa >= 3.7
        return { category: "good", delta, isPositive: true };
    }
}

/**
 * Get advisory message based on GPA impact category.
 * @param {string} category - The impact category from classifyGpaImpact
 * @returns {string} - HTML string with advisory message
 */
function getGpaAdvisoryMessage(category) {
    const messages = {
        big_drop: `
            <div class="gpa-advice gpa-advice-warning">
                <h6><i class="fas fa-exclamation-triangle me-2"></i>Heads Up</h6>
                <p>This plan will significantly <strong>lower your GPA</strong>.</p>
                <p>Before you commit, consider using Temple resources:</p>
                <ul>
                    <li><strong>Student Success Center</strong> for tutoring and study skills</li>
                    <li>Your <strong>academic advisor</strong> to discuss course load</li>
                    <li>Support options like learning communities and lighter electives</li>
                </ul>
            </div>
        `,
        small_drop: `
            <div class="gpa-advice gpa-advice-caution">
                <h6><i class="fas fa-info-circle me-2"></i>Something to Consider</h6>
                <p>This plan will cause a <strong>small dip</strong> in your GPA.</p>
                <p>That's not always bad — some classes are worth the challenge — but keep an eye on:</p>
                <ul>
                    <li>Weekly study time</li>
                    <li>Balancing high-intensity courses with one or two "GPA buffer" classes</li>
                    <li>Using <strong>office hours</strong> and <strong>tutoring</strong> early in the semester</li>
                </ul>
            </div>
        `,
        flat: `
            <div class="gpa-advice gpa-advice-neutral">
                <h6><i class="fas fa-equals me-2"></i>Steady as She Goes</h6>
                <p>This plan keeps your GPA <strong>about the same</strong>.</p>
                <p>If that matches your goals, you're on track. If you're aiming higher, consider:</p>
                <ul>
                    <li>Swapping a tough class for a better-fit elective</li>
                    <li>Blocking off dedicated study time on your calendar</li>
                    <li>Checking in with <strong>Temple Academic Advising</strong> about long-term goals</li>
                </ul>
            </div>
        `,
        good: `
            <div class="gpa-advice gpa-advice-success">
                <h6><i class="fas fa-star me-2"></i>Looking Good!</h6>
                <p>Nice work — this plan is likely to <strong>boost your GPA</strong>.</p>
                <p>Keep that trend going by:</p>
                <ul>
                    <li>Staying consistent with weekly study blocks</li>
                    <li>Protecting your sleep and mental health</li>
                    <li>Doing a mid-semester check-in on how this plan feels</li>
                </ul>
            </div>
        `
    };
    
    return messages[category] || "";
}

/**
 * Trigger a celebratory confetti burst for positive GPA outcomes.
 */
function triggerGpaConfetti() {
    // Create confetti burst element
    const confetti = document.createElement("div");
    confetti.className = "confetti-burst";
    confetti.innerHTML = "🎉🎓✨";
    document.body.appendChild(confetti);
    
    // Remove after animation completes
    setTimeout(() => {
        confetti.remove();
    }, 2500);
}

/**
 * Update or create the GPA comparison chart.
 * @param {number} currentGpa - The student's current GPA
 * @param {number} projectedGpa - The projected GPA after planned courses
 */
function updateGpaChart(currentGpa, projectedGpa) {
    const canvas = document.getElementById("gpaChart");
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    
    // Destroy existing chart if it exists
    if (gpaChartInstance !== null) {
        gpaChartInstance.destroy();
    }
    
    // Determine bar colors based on comparison
    const projectedColor = projectedGpa >= currentGpa 
        ? "rgba(40, 167, 69, 0.8)"  // Green for improvement
        : "rgba(220, 53, 69, 0.8)"; // Red for decline
    
    const projectedBorder = projectedGpa >= currentGpa 
        ? "#28a745" 
        : "#dc3545";
    
    gpaChartInstance = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["Current GPA", "Projected GPA"],
            datasets: [{
                data: [currentGpa, projectedGpa],
                backgroundColor: [
                    "rgba(177, 18, 38, 0.7)",  // Temple red for current
                    projectedColor
                ],
                borderColor: [
                    "#B11226",
                    projectedBorder
                ],
                borderWidth: 2,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return "GPA: " + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 4.0,
                    ticks: {
                        stepSize: 0.5,
                        color: "#666"
                    },
                    title: {
                        display: true,
                        text: "GPA",
                        color: "#666"
                    }
                },
                x: {
                    ticks: {
                        color: "#666",
                        font: {
                            weight: "600"
                        }
                    }
                }
            }
        }
    });
}

function calcGPAFrontEnd() {
    const current = parseFloat($("#gpa_current").val() || "0");
    const creditsCompleted = parseFloat($("#gpa_credits").val() || "0");
    const expectedStr = $("#gpa_expected").val() || "";

    // Validation
    if (isNaN(current) || current < 0 || current > 4) {
        setMessage("#gpa_result", "Please enter a valid GPA between 0 and 4.", "error");
        $("#gpa_current").addClass("is-invalid");
        return;
    }

    if (isNaN(creditsCompleted) || creditsCompleted < 0) {
        setMessage("#gpa_result", "Please enter valid credits completed.", "error");
        $("#gpa_credits").addClass("is-invalid");
        return;
    }

    if (!expectedStr.trim()) {
        setMessage("#gpa_result", "Please enter at least one expected grade.", "error");
        $("#gpa_expected").addClass("is-invalid");
        return;
    }

    // Clear validation states
    $("#gpa_current, #gpa_credits, #gpa_expected").removeClass("is-invalid");

    // Validate grade format on front-end before sending to Lambda
    const validGrades = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D", "F"];
    const expectedGrades = expectedStr.split(",").map(g => g.trim().toUpperCase()).filter(g => g !== "");
    
    if (expectedGrades.length === 0) {
        setMessage("#gpa_result", "Please enter at least one expected grade.", "error");
        return;
    }

    const invalidGrades = expectedGrades.filter(g => !validGrades.includes(g));
    if (invalidGrades.length > 0) {
        setMessage("#gpa_result", `Invalid grades: ${invalidGrades.join(", ")}. Supported: A, A-, B+, B, B-, C+, C, C-, D, F`, "error");
        return;
    }

    // Show loading state
    $("#btnCalcGPA").addClass("btn-loading").prop("disabled", true);
    showLoading("#gpa_result");

    // Build payload for Lambda
    const payload = {
        currentGpa: current,
        creditsCompleted: creditsCompleted,
        expectedGrades: expectedGrades.join(",")
    };

    console.log("GPA Calculator - Payload sent to API:", payload);

    // Call Lambda endpoint
    callToolEndpoint("gpa", payload)
        .then((results) => {
            console.log("GPA Calculator - Response received from API:", results);

            // Remove loading state
            $("#btnCalcGPA").removeClass("btn-loading").prop("disabled", false);

            // Extract values from Lambda response
            const projectedGpa = results.projectedGpa !== undefined ? results.projectedGpa : results.newGpa;
            const totalCredits = results.totalCredits !== undefined ? results.totalCredits : results.newTotalCredits;
            const termCredits = results.termCredits !== undefined ? results.termCredits : expectedGrades.length;
            const summary = results.summary || "";

            // Validate we have the data needed for advisor features
            const hasValidData = !isNaN(projectedGpa) && projectedGpa !== null && projectedGpa !== undefined;
            
            if (!hasValidData) {
                // Fallback to basic display if data is missing
                $("#gpa_result").removeClass().addClass("alert alert-warning mt-3 fade-in calculator-result").html(`
                    <h5><i class="fas fa-exclamation-circle me-2"></i>Calculation Issue</h5>
                    <p>We couldn't calculate your projected GPA. Please check your inputs and try again.</p>
                `);
                return;
            }

            // Store the result for contextual advisor
            lastGpaResult = {
                currentGpa: current,
                projectedGpa: projectedGpa,
                termCredits: termCredits,
                totalCredits: totalCredits
            };

            // Classify the GPA impact
            const impact = classifyGpaImpact(current, projectedGpa);
            
            // Check for good outcome (positive delta OR high projected GPA)
            const isGoodOutcome = impact.category === "good" || projectedGpa >= 3.7;
            
            // Get advisory message
            const advisoryMessage = getGpaAdvisoryMessage(isGoodOutcome ? "good" : impact.category);
            
            // Determine result alert class based on impact
            let alertClass = "alert-success";
            if (impact.category === "big_drop") alertClass = "alert-danger";
            else if (impact.category === "small_drop") alertClass = "alert-warning";
            else if (impact.category === "flat") alertClass = "alert-info";

            $("#gpa_result").removeClass().addClass(`alert ${alertClass} mt-3 fade-in calculator-result`).html(`
                <h5><i class="fas fa-graduation-cap me-2"></i>GPA Projection</h5>
                
                <!-- Chart Container -->
                <div class="gpa-chart-container">
                    <canvas id="gpaChart"></canvas>
                </div>
                
                <div class="gpa-numbers mt-3">
                    <div class="row text-center">
                        <div class="col-6">
                            <div class="gpa-stat">
                                <span class="gpa-label">Current</span>
                                <span class="gpa-value">${current.toFixed(2)}</span>
                            </div>
                        </div>
                        <div class="col-6">
                            <div class="gpa-stat">
                                <span class="gpa-label">Projected</span>
                                <span class="gpa-value gpa-value-projected">${parseFloat(projectedGpa).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="gpa-delta text-center mt-2">
                        <small class="text-muted">
                            ${impact.delta >= 0 ? "+" : ""}${impact.delta.toFixed(2)} change
                            (${termCredits} new credits → ${totalCredits} total)
                        </small>
                    </div>
                </div>
                
                <hr>
                
                <!-- Advisory Message -->
                ${advisoryMessage}
                
                <!-- Ask Advisor Button -->
                <div class="text-center mt-3">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="askAdvisorAboutGpa()">
                        <i class="fas fa-robot me-2"></i>Ask Advisor About This
                    </button>
                </div>
            `);
            
            // Update the chart after the canvas is in the DOM
            setTimeout(() => {
                updateGpaChart(current, projectedGpa);
            }, 50);
            
            // Trigger confetti for good outcomes
            if (isGoodOutcome) {
                setTimeout(() => {
                    triggerGpaConfetti();
                }, 300);
            }
        })
        .catch((error) => {
            console.error("GPA Calculator - Error received from API:", error);

            // Remove loading state
            $("#btnCalcGPA").removeClass("btn-loading").prop("disabled", false);

            if (error.sessionExpired) {
                setAuthState(false);
                showSection("div-login");
                setMessage("#login_message", error.message, "error");
            } else {
                setMessage("#gpa_result", error.message, "error");
            }
        });
}

/* ============================================
   BUDGET ESTIMATOR
============================================ */

function calcBudgetFrontEnd() {
    // Get raw values first to check for empty fields
    const rentRaw = $("#bdg_rent").val().trim();
    const foodRaw = $("#bdg_food").val().trim();
    const booksRaw = $("#bdg_books").val().trim();
    const incomeRaw = $("#bdg_income").val().trim();

    // Clear previous validation states
    $("#bdg_rent, #bdg_food, #bdg_books, #bdg_income").removeClass("is-invalid");

    // Check for empty fields
    let hasEmpty = false;
    if (rentRaw === "") {
        $("#bdg_rent").addClass("is-invalid");
        hasEmpty = true;
    }
    if (foodRaw === "") {
        $("#bdg_food").addClass("is-invalid");
        hasEmpty = true;
    }
    if (booksRaw === "") {
        $("#bdg_books").addClass("is-invalid");
        hasEmpty = true;
    }
    if (incomeRaw === "") {
        $("#bdg_income").addClass("is-invalid");
        hasEmpty = true;
    }

    if (hasEmpty) {
        setMessage("#budget_result", "Please fill in all fields before calculating.", "error");
        return;
    }

    // Parse values
    const rent = parseFloat(rentRaw);
    const food = parseFloat(foodRaw);
    const books = parseFloat(booksRaw);
    const income = parseFloat(incomeRaw);

    // Validation - check for valid numbers
    if (isNaN(rent) || isNaN(food) || isNaN(books) || isNaN(income)) {
        setMessage("#budget_result", "Please enter valid numbers for all fields.", "error");
        return;
    }

    if (rent < 0 || food < 0 || books < 0 || income < 0) {
        setMessage("#budget_result", "Values cannot be negative.", "error");
        return;
    }

    // Show loading state
    $("#btnCalcBudget").addClass("btn-loading").prop("disabled", true);
    showLoading("#budget_result");

    // Build payload for Lambda
    const payload = {
        rent: rent,
        food: food,
        books: books,
        income: income
    };

    console.log("Budget Calculator - Payload sent to API:", payload);

    // Call Lambda endpoint
    callToolEndpoint("budget", payload)
        .then((results) => {
            console.log("Budget Calculator - Response received from API:", results);

            // Remove loading state
            $("#btnCalcBudget").removeClass("btn-loading").prop("disabled", false);

            // Extract values from Lambda response
            const rentVal = results.rent !== undefined ? results.rent : rent;
            const foodVal = results.food !== undefined ? results.food : food;
            const booksVal = results.books !== undefined ? results.books : books;
            const incomeVal = results.income !== undefined ? results.income : income;
            const expenses = results.totalExpenses !== undefined ? results.totalExpenses : (rentVal + foodVal + booksVal);
            const remaining = results.remaining !== undefined ? results.remaining : (incomeVal - expenses);
            const status = results.status || (remaining >= 0 ? "good" : "over");
            const summary = results.summary || "";

            // Destroy existing chart
            if (budgetChartInstance !== null) {
                budgetChartInstance.destroy();
            }

            // Create new chart with Lambda response values
            const ctx = document.getElementById("budgetChart").getContext("2d");

            budgetChartInstance = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ["Rent / Housing", "Food", "Books / Supplies", "Remaining"],
                    datasets: [{
                        data: [rentVal, foodVal, booksVal, Math.max(remaining, 0)],
                        backgroundColor: [
                            "rgba(164, 30, 52, 0.8)",
                            "rgba(240, 173, 78, 0.8)",
                            "rgba(2, 117, 216, 0.8)",
                            "rgba(92, 184, 92, 0.8)"
                        ],
                        borderColor: [
                            "#A41E34",
                            "#F0AD4E",
                            "#0275D8",
                            "#5CB85C"
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { 
                            position: "bottom",
                            labels: {
                                padding: 15,
                                font: {
                                    size: 12
                                }
                            }
                        }
                    }
                }
            });

            // Determine display based on status from Lambda
            const isGood = status === "good" || status === "positive" || remaining >= 0;
            const resultClass = isGood ? "alert-success" : "alert-danger";
            const statusIcon = isGood ? "fa-check-circle" : "fa-exclamation-triangle";
            const statusText = isGood ? "Budget looks good!" : "Over budget!";

            // Store the result for contextual advisor
            lastBudgetResult = {
                income: incomeVal,
                totalExpenses: expenses,
                remaining: remaining,
                status: status
            };

            $("#budget_result").removeClass().addClass(`alert ${resultClass} mt-3 fade-in calculator-result`).html(`
                <h5><i class="fas ${statusIcon} me-2"></i>${statusText}</h5>
                <hr>
                <strong>Total Monthly Expenses:</strong> $${parseFloat(expenses).toFixed(2)}<br>
                <strong>Monthly Income:</strong> $${parseFloat(incomeVal).toFixed(2)}<br>
                <strong>Remaining After Expenses:</strong> $${parseFloat(remaining).toFixed(2)}<br>
                ${summary ? `<br><small class="text-muted"><em>${summary}</em></small>` : ""}
                
                <!-- Ask Advisor Button -->
                <div class="text-center mt-3">
                    <button type="button" class="btn btn-secondary btn-sm" onclick="askAdvisorAboutBudget()">
                        <i class="fas fa-robot me-2"></i>Ask Advisor About This
                    </button>
                </div>
            `);
        })
        .catch((error) => {
            console.error("Budget Calculator - Error received from API:", error);

            // Remove loading state
            $("#btnCalcBudget").removeClass("btn-loading").prop("disabled", false);

            if (error.sessionExpired) {
                setAuthState(false);
                showSection("div-login");
                setMessage("#login_message", error.message, "error");
            } else {
                setMessage("#budget_result", error.message, "error");
            }
        });
}

/* ============================================
   AI ADVISOR
============================================ */

/**
 * Get remaining advisor calls within the rate limit window.
 * @returns {number} - Number of remaining calls allowed
 */
function getAdvisorRemainingCalls() {
    const now = Date.now();
    // Filter out timestamps older than 1 hour
    advisorCallTimestamps = advisorCallTimestamps.filter(t => now - t < ADVISOR_RATE_WINDOW);
    return ADVISOR_RATE_LIMIT - advisorCallTimestamps.length;
}

/**
 * Update the rate limit display in the UI.
 */
function updateAdvisorRateLimitDisplay() {
    const remaining = getAdvisorRemainingCalls();
    const $rateLimit = $("#ai_rate_limit");
    const $rateCount = $("#ai_rate_count");
    
    $rateCount.text(remaining);
    
    if (remaining <= 3) {
        $rateLimit.removeClass("d-none alert-info alert-warning alert-danger")
                  .addClass(remaining === 0 ? "alert-danger" : "alert-warning");
    } else if (advisorCallTimestamps.length > 0) {
        $rateLimit.removeClass("d-none alert-warning alert-danger").addClass("alert-info");
    }
}

/**
 * Check if we can make an advisor call (client-side rate limit).
 * @returns {boolean} - True if call is allowed
 */
function canMakeAdvisorCall() {
    return getAdvisorRemainingCalls() > 0;
}

/**
 * Record an advisor call timestamp.
 */
function recordAdvisorCall() {
    advisorCallTimestamps.push(Date.now());
    updateAdvisorRateLimitDisplay();
}

function appendAIMessage(content, sender = "bot") {
    const cls = sender === "user" ? "ai-user" : "ai-bot";
    
    // Remove empty state if present
    $("#ai_empty_state").remove();
    
    $("#ai_history").append(`<div class="${cls} fade-in">${content}</div>`);
    
    // Scroll to bottom
    $("#aiChatBox").scrollTop($("#aiChatBox")[0].scrollHeight);
}

/**
 * Show typing indicator while waiting for advisor response.
 */
function showAdvisorTyping() {
    const typingHtml = `
        <div class="ai-bot ai-typing fade-in" id="ai_typing">
            <i class="fas fa-circle-notch fa-spin me-2"></i>CherryGuide is thinking...
        </div>
    `;
    $("#ai_history").append(typingHtml);
    $("#aiChatBox").scrollTop($("#aiChatBox")[0].scrollHeight);
}

/**
 * Remove typing indicator.
 */
function hideAdvisorTyping() {
    $("#ai_typing").remove();
}

/**
 * Call the advisor endpoint with a message.
 * @param {string} message - The message to send to the advisor
 * @param {boolean} isContextual - Whether this is a contextual query from a calculator
 */
function askAdvisor(message, isContextual = false) {
    const token = localStorage.getItem("token");
    
    if (!token || token.trim() === "") {
        setMessage("#ai_message", "Session expired. Please login again.", "error");
        setAuthState(false);
        showSection("div-login");
        return;
    }

    if (!message || message.trim() === "") {
        return;
    }

    // Check client-side rate limit
    if (!canMakeAdvisorCall()) {
        setMessage("#ai_message", 
            "<i class='fas fa-clock me-2'></i>You've reached the advisor limit for this hour. Try again later.", 
            "warning");
        return;
    }

    // Show user message in chat
    appendAIMessage(message, "user");
    $("#ai_question").val("");

    // Clear any previous message
    clearMessage("#ai_message");

    // Show typing indicator
    showAdvisorTyping();

    // Disable input while waiting
    $("#btnAskAI").addClass("btn-loading").prop("disabled", true);
    $("#ai_question").prop("disabled", true);

    // Build the request
    const data = "token=" + encodeURIComponent(token) + "&message=" + encodeURIComponent(message);

    console.log("Advisor request:", { token: token.substring(0, 8) + "...", message: message });

    $.ajax({
        url: CONFIG.API_ENDPOINT + "/advisor",
        method: "POST",
        data: data,
        success: (results) => {
            console.log("Advisor response:", results);
            
            hideAdvisorTyping();
            
            // Re-enable input
            $("#btnAskAI").removeClass("btn-loading").prop("disabled", false);
            $("#ai_question").prop("disabled", false).focus();

            // Record the call for rate limiting
            recordAdvisorCall();

            // Extract advisor response
            const reply = results.advisor || results.message || "I'm here to help! Could you rephrase your question?";
            
            // Display the response
            appendAIMessage(reply, "bot");
        },
        error: (xhr) => {
            console.error("Advisor error:", xhr.status, xhr.statusText, xhr.responseText);
            
            hideAdvisorTyping();
            
            // Re-enable input
            $("#btnAskAI").removeClass("btn-loading").prop("disabled", false);
            $("#ai_question").prop("disabled", false).focus();

            // Handle rate limit error (429)
            if (xhr.status === 429) {
                setMessage("#ai_message", 
                    "<i class='fas fa-clock me-2'></i>You've reached the advisor limit (10/hour). Please try again later.", 
                    "warning");
                // Update local rate limit display
                updateAdvisorRateLimitDisplay();
                return;
            }

            // Handle other errors
            let errorMsg = "Sorry, I couldn't process your request. Please try again.";
            if (xhr.responseJSON && xhr.responseJSON.error) {
                errorMsg = xhr.responseJSON.error;
            } else if (xhr.responseText) {
                try {
                    const parsed = JSON.parse(xhr.responseText);
                    errorMsg = parsed.error || parsed.message || errorMsg;
                } catch (e) {
                    // Keep default error message
                }
            }

            appendAIMessage(`<i class="fas fa-exclamation-circle me-2"></i>${errorMsg}`, "bot");
        }
    });
}

/**
 * Ask advisor with context from the last GPA calculation.
 */
function askAdvisorAboutGpa() {
    if (!lastGpaResult) {
        setMessage("#ai_message", "Please calculate your GPA first.", "warning");
        showSection("div-gpa");
        return;
    }

    const { currentGpa, projectedGpa, termCredits, totalCredits } = lastGpaResult;
    
    let contextMessage = `My current GPA is ${currentGpa.toFixed(2)} with ${totalCredits - termCredits} credits completed. `;
    contextMessage += `After taking ${termCredits} more credits this semester, my projected GPA will be ${projectedGpa.toFixed(2)}. `;
    
    if (projectedGpa < currentGpa) {
        contextMessage += "What should I consider to improve my academic performance at Temple?";
    } else if (projectedGpa >= 3.7) {
        contextMessage += "How can I maintain this strong academic performance while staying balanced?";
    } else {
        contextMessage += "What Temple resources can help me succeed academically?";
    }

    // Navigate to AI section and send the contextual question
    showSection("div-ai");
    setTimeout(() => {
        askAdvisor(contextMessage, true);
    }, 300);
}

/**
 * Ask advisor with context from the last Budget calculation.
 */
function askAdvisorAboutBudget() {
    if (!lastBudgetResult) {
        setMessage("#ai_message", "Please calculate your budget first.", "warning");
        showSection("div-budget");
        return;
    }

    const { income, totalExpenses, remaining, status } = lastBudgetResult;
    
    let contextMessage = `My monthly income is $${income.toFixed(2)}, and my total monthly expenses are $${totalExpenses.toFixed(2)}. `;
    
    if (status === "over" || remaining < 0) {
        contextMessage += `I'm over budget by $${Math.abs(remaining).toFixed(2)} per month. `;
        contextMessage += "How do Temple students typically handle budget shortfalls? What resources are available?";
    } else if (remaining < 100) {
        contextMessage += `I only have $${remaining.toFixed(2)} left per month, which is tight. `;
        contextMessage += "What are some ways Temple students save money on campus?";
    } else {
        contextMessage += `I have $${remaining.toFixed(2)} remaining each month. `;
        contextMessage += "What financial tips do you have for Temple students to make the most of their budget?";
    }

    // Navigate to AI section and send the contextual question
    showSection("div-ai");
    setTimeout(() => {
        askAdvisor(contextMessage, true);
    }, 300);
}

/* ============================================
   DOCUMENT READY: INITIALIZE APP
============================================ */

$(document).ready(() => {

    // Scroll to top on load
    $("html, body").animate({ scrollTop: 0 }, 0);

    // CRITICAL: Hide all sections on load, let JS control visibility
    $(".content-wrapper").hide();

    // Check authentication state and show appropriate section
    checkAuthOnLoad();

    // Collapse navbar on link click (mobile)
    $('.nav-link').click(() => {
        $(".navbar-collapse").collapse('hide');
    });

    // Allow Enter key to submit forms
    $("#username, #password").keypress(function(e) {
        if (e.which === 13) {
            loginController();
        }
    });

    /* ========================================
       NAVIGATION LINKS
    ======================================== */

    $("#link-dashboard").click((e) => {
        e.preventDefault();
        showSection("div-dashboard");
    });

    $("#link-explore").click((e) => {
        e.preventDefault();
        showSection("div-explore");
    });

    $("#link-tools").click((e) => {
        e.preventDefault();
        showSection("div-tools");
    });

    $("#link-ai").click((e) => {
        e.preventDefault();
        showSection("div-ai");
    });

    $("#link-game").click((e) => {
        e.preventDefault();
        startGameController();
    });

    $("#link-logout").click(async (e) => {
        e.preventDefault();
        await logoutController();
    });

    /* ========================================
       DASHBOARD TILES
    ======================================== */

    $("#btnGoExplore").click(() => {
        showSection("div-explore");
    });

    $("#btnGoTools").click(() => {
        showSection("div-tools");
    });

    $("#btnGoAI").click(() => {
        showSection("div-ai");
    });

    $("#btnGoGame").click(() => {
        startGameController();
    });

    /* ========================================
       TOOLS TILES
    ======================================== */

    $("#btnGoGPA").click(() => {
        showSection("div-gpa");
    });

    $("#btnGoBudget").click(() => {
        showSection("div-budget");
    });

    /* ========================================
       LOGIN / SIGNUP
    ======================================== */

    $("#btnLogin").click(() => {
        loginController();
    });

    $("#link-signup").click((e) => {
        e.preventDefault();
        showSection("div-signup");
    });

    $("#btnSignup").click(() => {
        signupController();
    });

    $("#btnSignupBack").click(() => {
        clearMessage("#signup_message");
        showSection("div-login");
    });

    /* ========================================
       GAME BUTTONS
    ======================================== */

    $("#btnCheck1").click(() => submitGuess(1));
    $("#btnCheck2").click(() => submitGuess(2));
    $("#btnCheck3").click(() => submitGuess(3));

    $("#btnEndGame").click(() => {
        endGameController();
    });

    $("#btnQuit2").click(async () => {
        await cancelGameController();
        // Cancel game deletes logins record, so we must fully logout
        localStorage.removeItem("token");
        setAuthState(false);
        showSection("div-login");
        setMessage("#login_message", "Game cancelled. Please log in to play again.", "info");
    });

    $("#btnQuit3").click(async () => {
        // Token was already invalidated by /endgame, just clean up frontend
        localStorage.removeItem("token");
        setAuthState(false);
        showSection("div-login");
        setMessage("#login_message", "Thanks for playing! Log in to play again.", "success");
    });

    // View Leaderboard & Quit - shows leaderboard, user will logout via button there
    // Note: /endgame already called by "Finish Game" button, token already invalidated
    $("#btnViewLeaderboardQuit").click(async () => {
        showSection("div-leaderboard");
        loadLeaderboard();
    });

    /* ========================================
       LEADERBOARD
    ======================================== */

    // Back from leaderboard - logout since token was invalidated by endgame
    $("#btnHome").click(async () => {
        // Token was already invalidated by /endgame, just clean up frontend
        localStorage.removeItem("token");
        setAuthState(false);
        showSection("div-login");
        setMessage("#login_message", "Thanks for playing! Log in to play again.", "success");
    });

    /* ========================================
       CALCULATORS
    ======================================== */

    $("#btnCalcGPA").click(() => {
        calcGPAFrontEnd();
    });

    $("#btnCalcBudget").click(() => {
        calcBudgetFrontEnd();
    });

    /* ========================================
       EXPLORE PAGE TABS
    ======================================== */

    // Tab switching for Explore section
    $(".explore-tab").click(function() {
        const targetId = $(this).data("target");
        
        // Update active tab
        $(".explore-tab").removeClass("active");
        $(this).addClass("active");
        
        // Update active panel
        $(".explore-panel").removeClass("active");
        $("#" + targetId).addClass("active");
    });

    /* ========================================
       AI ADVISOR
    ======================================== */

    $("#btnAskAI").click((e) => {
        e.preventDefault();
        const question = $("#ai_question").val().trim();
        if (question) {
            askAdvisor(question);
        }
    });

    // Allow Enter key for AI question
    $("#ai_question").keypress(function(e) {
        if (e.which === 13) {
            e.preventDefault();
            const question = $(this).val().trim();
            if (question) {
                askAdvisor(question);
            }
        }
    });

    /* ========================================
       ACCESSIBILITY
    ======================================== */

    // ARIA attributes
    $('.navbar').attr('role', 'navigation').attr('aria-label', 'Main Navigation');
    $('#form-login').attr('aria-label', 'Login Form');
    $('#form-signup').attr('aria-label', 'Signup Form');

    // Make tiles keyboard accessible
    $('.cherry-tile').keypress(function(e) {
        if (e.which === 13 || e.which === 32) { // Enter or Space
            e.preventDefault();
            $(this).click();
        }
    });

    console.log("✅ CherryGuide initialized successfully!");
});