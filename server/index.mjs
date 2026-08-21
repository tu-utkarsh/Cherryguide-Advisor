// REMINDER - Don't forget to change your database connection
// timeout from 3 seconds to 3 minutes.
// Look under Configuration / General Configuration

// declarations (not all are needed) *****************************************
import qs from 'qs'; //for parsing URL encoded data
import axios from 'axios'; // for calling another API
import mysql from 'mysql2/promise';  //for talking to a database
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";



// SECURITY NOTE:
// credentials directly in source. Credentials are now read from Lambda
// environment variables instead - configure these under
// Lambda > Configuration > Environment variables.
const dboptions = {
  'user'     : process.env.DB_USER,
  'password' : process.env.DB_PASSWORD,
  'database' : process.env.DB_NAME,
  'host'     : process.env.DB_HOST
};

//global connection variable
var connection;

const features = [
	  
"Issue a POST to login and provide the keys of username and password.  If authenticated, the result will be the JSON object of the user.",
"Issue a POST to startgame to start a game.  Provide a valid token. If successful, the result will be a JSON gameprogress object.",
"Issue a PATCH against guess1 and provide the keys of token and guess. If successful, the result will be either CORRECT or INCORRECT",
"Issue a PATCH against guess2 and provide the keys of token and guess. If successful, the result will be either CORRECT or INCORRECT",
"Issue a PATCH against guess3 and provide the keys of token and guess. If successful, the result will be either CORRECT or INCORRECT",
"Issue a POST against endgame and provide a token. If successful, the result will be 'Hunt Complete!'",
"Issue a DELETE against cancelgame and provide a token. If successful, the result will be 'Game cancelled'",
"Issue a GET against leaderboard for a JSON object showing the top 5 users.",
"Issue a GET against debugusers for a JSON object of all users.",
"Issue a GET against debuglogins for a JSON object of all logins.",
"Issue a GET against debuggames for a JSON object of all games.",
"Issue a GET against debuggameprogress for a JSON object of all gameprogress.",
"Issue a GET against debugleaderboard for a JSON object of all leaderboard records."

	];
  let advisorRateLimit = {}; 


// supporting functions ******* STUDENT MAY EDIT ***********

// 1. Get user info from token
let getUserByToken = async (token) => {
  if (!token) return null;
  let [rows] = await connection.execute(
    "SELECT u.userid, u.isadmin FROM users u JOIN logins l ON u.userid = l.userid WHERE l.token = ?",
    [token]
  );
  return rows.length ? rows[0] : null;
};
// 1b. Require the token to belong to an admin user - used to gate the debug routes
let requireAdmin = async (query) => {
  let token = query && query.token;
  if (!token) return false;
  let user = await getUserByToken(token);
  if (!user) return false;
  return user.isadmin === 'Y';
};
// 2. Get active game for user
let getActiveGame = async (userid) => {
  let [rows] = await connection.execute(
    "SELECT gameid FROM games WHERE userid = ? AND isactive = 1",
    [userid]
  );
  return rows.length ? rows[0] : null;
};

// 3. Require a valid active game given a token
let requireActiveGame = async (token) => {
  let user = await getUserByToken(token);
  if (!user) throw new Error("Invalid token.");
  let game = await getActiveGame(user.userid);
  if (!game) throw new Error("No active game found.");
  return { user, game };
};

// 4. Consistent JSON responses
let jsonOk = (res, data) => formatres(res, data, 200);
let jsonBadRequest = (res, msg) => formatres(res, { error: msg }, 400);

let getUsers = async (res,query) => {
	//work and return the result
	let [result] = await connection.execute("SELECT * FROM users");
	return formatres(res,result,200);
}



let getLogins = async (res,query) => {
    let [result] = await connection.execute("SELECT * FROM logins");
    return formatres(res,result,200);
}

let getGames = async (res,query) => {
    let [result] = await connection.execute("SELECT * FROM games");
    return formatres(res,result,200);
}

let getGameProgress = async (res,query) => {
    let [result] = await connection.execute("SELECT * FROM gameprogress");
    return formatres(res,result,200);
}
// Very safe token validation (does NOT alter or interfere with HuntZilla)
// Only checks that token exists & maps to an active user.
let validateTokenBasic = async (token) => {
  if (!token || token.trim() === "") return null;

  let [rows] = await connection.execute(
    "SELECT userid FROM users WHERE lasttoken = ?",
    [token]
  );

  if (rows.length === 0) return null;

  return rows[0].userid; // keep it simple
};

let getLeaderboard = async (res,query) => {
    let [result] = await connection.execute("SELECT * FROM leaderboard");
    return formatres(res,result,200);
}

let theDatetimeFunction = async (res,query) => {
	//work and return the result
	let [result] = await connection.execute("select DATE_FORMAT(NOW(), '%m-%d-%Y %h:%i %p') AS the_date_and_time");
	return formatres(res,result[0]['the_date_and_time'],200);
}

let myName = (res,query) => {
	//work and return the result
	return formatres(res,"NoName McHiggens",200);
}
let postLogin = async (res, body) => {
  // 1. Extract username and password from the request body
  let username = body.username;
  let password = body.password;

  // Validate that both fields have been provided
  if (username == undefined || username.trim() == "") {
    return formatres(res, "Username is missing or incorrect.", 400);
  }
  if (password == undefined || password.trim() == "") {
    return formatres(res, "Password is missing or incorrect.", 400);
  }

  // 2. Check if username/password combination exists
  //    The ? placeholders are bound to [username, password]
  let txtSQL1 = "SELECT * FROM users WHERE username = ? AND password = ?";
  let [result1] = await connection.execute(txtSQL1, [username, password]);

  // If no user was found, send a 400 error
  if (result1.length == 0) {
    return formatres(res, "Login failed.", 400);
  }

  // 3. Insert a new row in the logins table with a randomly generated token
  //    and the current timestamp; associate it with the user’s id
  let userid = result1[0].userid;
  let txtSQL2 =
    "INSERT INTO logins (token, logints, userid) VALUES (UUID(), NOW(), ?)";
  let [result2] = await connection.execute(txtSQL2, [userid]);

  // result2.insertId contains the auto‑increment id of the newly inserted
  // row.  mysql2 returns this after an INSERT query
  let loginid = result2.insertId;

  // 4. Retrieve the token just created using loginid
  let txtSQL3 = "SELECT token FROM logins WHERE loginid = ?";
  let [result3] = await connection.execute(txtSQL3, [loginid]);
  let newtoken = result3[0].token;

  // 5. Update the user’s lasttoken field in the users table
  let txtSQL4 = "UPDATE users SET lasttoken = ? WHERE userid = ?";
  let [result4] = await connection.execute(txtSQL4, [newtoken, userid]);

  // 6. Fetch and return the user’s public information along with the new token
  //    Columns returned: username, first name, last name, lasttoken, and isadmin
  let txtSQL5 =
    "SELECT username, fname, lname, lasttoken, isadmin FROM users WHERE userid = ?";
  let [result5] = await connection.execute(txtSQL5, [userid]);

  // 7. Send the final response
  return formatres(res, result5, 200);
};
//signup feature
let signup = async (res, body) => {
  try {
    let fname = body.fname;
    let lname = body.lname;
    let username = body.username;
    let password = body.password;

    // Validate required fields
    if (!fname || !lname || !username || !password) {
      return formatres(res, "All fields (fname, lname, username, password) are required.", 400);
    }

    // Trim to prevent weird spaces
    username = username.trim();

    // Check if username already exists
    let [check] = await connection.execute(
      "SELECT userid FROM users WHERE username = ?",
      [username]
    );

    if (check.length > 0) {
      return formatres(res, "Username already exists. Pick another.", 400);
    }

    // Insert user
    let [result] = await connection.execute(
      "INSERT INTO users (fname, lname, username, password, isadmin) VALUES (?, ?, ?, ?, 'N')",
      [fname, lname, username, password]
    );

    return formatres(res, "Signup successful!", 200);

  } catch (err) {
    console.error("Signup error:", err);
    return formatres(res, "Server error: " + err.message, 500);
  }
};


let startGame = async (res, body) => {
  try {
    const token = body.token;
    if (!token || token.trim() === "") {
      return jsonBadRequest(res, "Token is required.");
    }

    // Validate token and get user
    const user = await getUserByToken(token);
    if (!user) {
      return jsonBadRequest(res, "Invalid token.");
    }

    // 🧹 Defensive cleanup: mark old active games as complete if user's token is NULL
    await connection.execute(`
      UPDATE gameprogress gp
      JOIN users u ON gp.userid = u.userid
      SET gp.status = 'COMPLETE'
      WHERE gp.status = 'ACTIVE' AND u.lasttoken IS NULL;
    `);

    // Check for existing active game
    //const txtCheck = "SELECT progressid FROM gameprogress WHERE userid = ? AND status = 'ACTIVE'";
    //const [checkResult] = await connection.execute(txtCheck, [user.userid]);
    //if (checkResult.length > 0) {
      //return jsonBadRequest(res, "Active game already in progress.");
    //}

    // Check for existing active game
const txtCheck = "SELECT progressid FROM gameprogress WHERE userid = ? AND status = 'ACTIVE'";
const [checkResult] = await connection.execute(txtCheck, [user.userid]);

if (checkResult.length > 0) {
  const existingId = checkResult[0].progressid;

  // Instead of blocking, clear previous guesses and reset timestamps
  await connection.execute(`
    UPDATE gameprogress
    SET 
      u1 = '', u2 = '', u3 = '',
      msg1 = NULL, msg2 = NULL, msg3 = NULL,
      startts = NOW(), endts = NULL, secondsduration = NULL
    WHERE progressid = ?
  `, [existingId]);

  console.log("Reusing existing active game for user:", user.userid);

  // Return the same object (so frontend re-renders cleanly)
  const [output] = await connection.execute(`
    SELECT progressid, intro, 
           q1, u1, msg1, 
           q2, u2, msg2, 
           q3, u3, msg3, 
           startts, endts, secondsduration, 
           token, status
    FROM gameprogress
    WHERE progressid = ?
  `, [existingId]);

  return jsonOk(res, output);
}



    // Select one random game template
    const [templateGames] = await connection.execute("SELECT * FROM games ORDER BY RAND() LIMIT 1");
    if (templateGames.length === 0) {
      return jsonBadRequest(res, "No game templates found.");
    }

    const g = templateGames[0];

    // Insert into gameprogress (copy questions/answers)
    const insertSQL = `
      INSERT INTO gameprogress (
        intro, q1, a1, q2, a2, q3, a3,
        u1, u2, u3, msg1, msg2, msg3,
        startts, endts, secondsduration,
        userid, token, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ' ', ' ', ' ', NULL, NULL, NULL, NOW(), NULL, NULL, ?, ?, 'ACTIVE')
    `;
    const [insertResult] = await connection.execute(insertSQL, [
      g.intro,
      g.q1, g.a1,
      g.q2, g.a2,
      g.q3, g.a3,
      user.userid,
      token
    ]);

    const newProgressId = insertResult.insertId;

    // ✅ Return full object (matching professor's format)
    const [output] = await connection.execute(
      `SELECT progressid, intro, 
              q1, u1, msg1, 
              q2, u2, msg2, 
              q3, u3, msg3, 
              startts, endts, secondsduration, 
              token, status
       FROM gameprogress
       WHERE progressid = ?`,
      [newProgressId]
    );

    return jsonOk(res, output);
  } catch (err) {
    console.error("Error in startGame:", err);
    return jsonBadRequest(res, `Server error: ${err.message}`);
  }
};
let guess1 = async (res, body) => {
  try {
    const token = body.token;
    const guess = body.guess;

    // 1. Validate inputs
    if (!token || token.trim() === "") {
      return formatres(res, "Token is required.", 400);
    }
    if (!guess || guess.trim() === "") {
      return formatres(res, "Guess is required.", 400);
    }

    // 2. Validate token in users table
    let [userCheck] = await connection.execute(
      "SELECT userid FROM users WHERE lasttoken = ?",
      [token]
    );
    if (userCheck.length === 0) {
      return formatres(res, "Invalid token.", 400);
    }

    // 3. Retrieve the active game for this token
    let [games] = await connection.execute(
      "SELECT progressid, a1 FROM gameprogress WHERE token = ? AND status = 'ACTIVE' ORDER BY progressid DESC LIMIT 1",
      [token]
    );
    if (games.length === 0) {
      return formatres(res, "No active game found.", 400);
    }

    const game = games[0];
    const correctAnswer = (game.a1 || "").trim().toLowerCase();
    const userGuess = guess.trim().toLowerCase();

    const result = correctAnswer === userGuess ? "CORRECT" : "INCORRECT";

    // 4. Update gameprogress with guess and result
    await connection.execute(
      "UPDATE gameprogress SET u1 = ?, msg1 = ? WHERE progressid = ?",
      [guess, result, game.progressid]
    );

    // 5. Return JSON response
    return formatres(res, { result: result }, 200);
  } catch (err) {
    console.error("Error in guess1:", err);
    return formatres(res, `Server error: ${err.message}`, 400);
  }
};


let guess2 = async (res, body) => {
  try {
    const token = body.token;
    const guess = body.guess;

    if (!token || token.trim() === "") {
      return formatres(res, "Token is required.", 400);
    }
    if (!guess || guess.trim() === "") {
      return formatres(res, "Guess is required.", 400);
    }

    let [userCheck] = await connection.execute(
      "SELECT userid FROM users WHERE lasttoken = ?",
      [token]
    );
    if (userCheck.length === 0) {
      return formatres(res, "Invalid token.", 400);
    }

    let [games] = await connection.execute(
      "SELECT progressid, a2 FROM gameprogress WHERE token = ? AND status = 'ACTIVE' ORDER BY progressid DESC LIMIT 1",
      [token]
    );
    if (games.length === 0) {
      return formatres(res, "No active game found.", 400);
    }

    const game = games[0];
    const correctAnswer = (game.a2 || "").trim().toLowerCase();
    const userGuess = guess.trim().toLowerCase();

    const result = correctAnswer === userGuess ? "CORRECT" : "INCORRECT";

    await connection.execute(
      "UPDATE gameprogress SET u2 = ?, msg2 = ? WHERE progressid = ?",
      [guess, result, game.progressid]
    );

    return formatres(res, { result: result }, 200);
  } catch (err) {
    console.error("Error in guess2:", err);
    return formatres(res, `Server error: ${err.message}`, 400);
  }
};


let guess3 = async (res, body) => {
  try {
    const token = body.token;
    const guess = body.guess;

    if (!token || token.trim() === "") {
      return formatres(res, "Token is required.", 400);
    }
    if (!guess || guess.trim() === "") {
      return formatres(res, "Guess is required.", 400);
    }

    let [userCheck] = await connection.execute(
      "SELECT userid FROM users WHERE lasttoken = ?",
      [token]
    );
    if (userCheck.length === 0) {
      return formatres(res, "Invalid token.", 400);
    }

    let [games] = await connection.execute(
      "SELECT progressid, a3 FROM gameprogress WHERE token = ? AND status = 'ACTIVE' ORDER BY progressid DESC LIMIT 1",
      [token]
    );
    if (games.length === 0) {
      return formatres(res, "No active game found.", 400);
    }

    const game = games[0];
    const correctAnswer = (game.a3 || "").trim().toLowerCase();
    const userGuess = guess.trim().toLowerCase();

    const result = correctAnswer === userGuess ? "CORRECT" : "INCORRECT";

    await connection.execute(
      "UPDATE gameprogress SET u3 = ?, msg3 = ? WHERE progressid = ?",
      [guess, result, game.progressid]
    );

    // Note: Do NOT set status = COMPLETE here (endgame will handle it)

    return formatres(res, { result: result }, 200);
  } catch (err) {
    console.error("Error in guess3:", err);
    return formatres(res, `Server error: ${err.message}`, 400);
  }
};

let endgame = async (res, body) => {
  try {
    const token = body.token;

    // 1. Validate input
    if (!token || token.trim() === "") {
      return formatres(res, "Token is required.", 400);
    }

    // 2. Validate token in users table
    let [userCheck] = await connection.execute(
      "SELECT userid, username FROM users WHERE lasttoken = ?",
      [token]
    );
    if (userCheck.length === 0) {
      return formatres(res, "Invalid token.", 400);
    }

    const userid = userCheck[0].userid;
    const username = userCheck[0].username;

    // 3. Check if all msg1, msg2, msg3 = 'CORRECT'
    let [progress] = await connection.execute(
      "SELECT progressid, msg1, msg2, msg3 FROM gameprogress WHERE token = ? AND status = 'ACTIVE' ORDER BY progressid DESC LIMIT 1",
      [token]
    );

    if (progress.length === 0) {
      return formatres(res, "No active game found.", 400);
    }

    const g = progress[0];
    const allCorrect =
      g.msg1 === "CORRECT" && g.msg2 === "CORRECT" && g.msg3 === "CORRECT";

    if (!allCorrect) {
      return formatres(res, "Keep Hunting!", 400);
    }

    // 4. Update endts and compute secondsduration
    await connection.execute(
      "UPDATE gameprogress SET endts = NOW(), secondsduration = TIMESTAMPDIFF(SECOND, startts, NOW()), status = 'COMPLETE' WHERE progressid = ?",
      [g.progressid]
    );

    // 5. Get the secondsduration we just computed
    let [durationRow] = await connection.execute(
      "SELECT secondsduration FROM gameprogress WHERE progressid = ?",
      [g.progressid]
    );
    const seconds = durationRow[0].secondsduration;

    // 6. Insert leaderboard entry
    await connection.execute(
      "INSERT INTO leaderboard (userid, username, seconds) VALUES (?, ?, ?)",
      [userid, username, seconds]
    );

    // 7. Nullify user's lasttoken
    await connection.execute(
      "UPDATE users SET lasttoken = NULL WHERE userid = ?",
      [userid]
    );

    // 8. Return success
    return formatres(res, "Hunt Complete!", 200);
  } catch (err) {
    console.error("Error in endgame:", err);
    return formatres(res, `Server error: ${err.message}`, 400);
  }
};

// Cancel Game
let cancelGame = async (res, body) => {
  try {
    const token = body.token;
    if (!token || token.trim() === "") {
      return jsonBadRequest(res, "Token is required.");
    }

    // Validate token via users table
    const [userRows] = await connection.execute(
      "SELECT userid FROM users WHERE lasttoken = ?",
      [token]
    );
    if (userRows.length === 0) {
      return jsonBadRequest(res, "Invalid token.");
    }
    const userid = userRows[0].userid;

    // Delete from gameprogress
    await connection.execute(
      "DELETE FROM gameprogress WHERE token = ? AND userid = ?",
      [token, userid]
    );

    // Delete from logins
    await connection.execute(
      "DELETE FROM logins WHERE token = ? AND userid = ?",
      [token, userid]
    );
 

    return jsonOk(res, { message: "Game cancelled." });
  } catch (error) {
    console.error("Cancel game error:", error);
    return jsonServerError(res, `Server error: ${error.message}`);
  }
};

let getLeaderboardTop5 = async (res, query) => {
  try {
    const [rows] = await connection.execute(
      "SELECT * FROM leaderboard ORDER BY seconds ASC LIMIT 5"
    );
    return formatres(res, rows, 200);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return formatres(res, { error: "Server error: " + error.message }, 500);
  }
};

// ===============================
// GPA CALCULATOR (SAFE, PURE LOGIC)
// ===============================
let toolGpa = async (res, body) => {
  try {
    // 1. Validate token
    let userid = await validateTokenBasic(body.token);
    if (!userid) {
      return formatres(res, { error: "Invalid or missing token." }, 400);
    }

    // 2. Parse inputs - Support both formats:
    //    - creditsCompleted (from front-end) or currentCredits
    //    - expectedGrades as comma-separated string (from front-end) or plannedCourses array
    let currentGpa = parseFloat(body.currentGpa);
    let currentCredits = parseFloat(body.currentCredits || body.creditsCompleted);
    let expectedGradesStr = body.expectedGrades || "";
    let planned = body.plannedCourses || [];

    if (isNaN(currentGpa) || isNaN(currentCredits) || currentCredits < 0) {
      return formatres(res, { error: "Invalid GPA or credit values." }, 400);
    }

    // 3. Grade scale
    let scale = {
      "A":4.0, "A-":3.7,
      "B+":3.3, "B":3.0, "B-":2.7,
      "C+":2.3, "C":2.0, "C-":1.7,
      "D":1.0, "F":0.0
    };

    // 4. Calculate - handle both input formats
    let qualityBefore = currentGpa * currentCredits;
    let newCredits = 0;
    let qualityNew = 0;

    // If expectedGrades string is provided (simple front-end format)
    // Each grade = 1 credit (3-credit course assumption can be changed)
    if (expectedGradesStr && expectedGradesStr.trim() !== "") {
      let grades = expectedGradesStr.split(",").map(g => g.trim().toUpperCase()).filter(g => g !== "");
      for (let grade of grades) {
        if (scale[grade] !== undefined) {
          // Assume each course is 3 credits (standard Temple course)
          let cr = 3;
          newCredits += cr;
          qualityNew += cr * scale[grade];
        }
      }
    } else {
      // Use plannedCourses array format (advanced format)
      for (let c of planned) {
        let cr = parseFloat(c.credits);
        let grade = (c.grade || "").trim();
        if (!isNaN(cr) && scale[grade] !== undefined) {
          newCredits += cr;
          qualityNew += cr * scale[grade];
        }
      }
    }

    let totalCredits = currentCredits + newCredits;
    let totalQuality = qualityBefore + qualityNew;
    let projected = totalCredits > 0 ? totalQuality / totalCredits : currentGpa;

    // 5. Build AI-friendly result object
    let result = {
      tool: "gpa",
      userid: userid,
      currentGpa: currentGpa,
      currentCredits: currentCredits,
      addedCredits: newCredits,
      totalCredits: totalCredits,
      termCredits: newCredits,
      qualityBefore: qualityBefore,
      qualityAfter: totalQuality,
      projectedGpa: Number(projected.toFixed(3)),
      summary: `Projected GPA is ${projected.toFixed(2)} based on ${newCredits} new credits.`,

      // structured context for Bedrock later:
      context: {
        type: "gpa_projection",
        gpa_before: currentGpa,
        gpa_after: Number(projected.toFixed(3)),
        credits_before: currentCredits,
        credits_after: totalCredits
      }
    };

    return formatres(res, result, 200);

  } catch (err) {
    console.error("GPA tool error:", err);
    return formatres(res, { error: err.message }, 500);
  }
};
// =============================================
// ADVISOR (TEMPLE AI ADVICE) - USES BEDROCK
// =============================================
let advisorHandler = async (res, body) => {
  try {
    // 1. Extract token + message
    let token = body.token;
    let message = body.message;

    if (!token || token.trim() === "") {
      return formatres(res, { error: "Token is required." }, 400);
    }

    if (!message || message.trim() === "") {
      return formatres(res, { error: "Message is required." }, 400);
    }

    // 2. Validate token using your existing helper
    let userid = await validateTokenBasic(token);
    if (!userid) {
      return formatres(res, { error: "Invalid token." }, 400);
    }

    // 3. Rate limit (10 messages per hour per user)
    const now = Date.now();

    if (!advisorRateLimit[userid]) {
      advisorRateLimit[userid] = [];
    }

    // keep only last hour
    advisorRateLimit[userid] = advisorRateLimit[userid].filter(
      t => now - t < 60 * 60 * 1000
    );

    if (advisorRateLimit[userid].length >= 10) {
      return formatres(res, { error: "Advisor limit reached (10/hr)." }, 429);
    }

    advisorRateLimit[userid].push(now);

    // 4. Build system + user prompt
    let systemPrompt = `
You are CherryGuide, a friendly helper for Temple University students.
You give practical, down-to-earth advice about:
- Study skills, time management, and exam prep
- Navigating campus resources (tutoring, writing center, student success)
- Campus life, getting around campus, and student routines
- High-level guidance on degree planning and choosing classes
- Budgeting and life-balance tips for college students

If the student asks about an OFFICIAL POLICY, REQUIREMENT, DEADLINE, ACADEMIC WARNING/PROBATION, CREDIT OVERLOAD, OR IMMIGRATION/VISA RULES:
  - Answer in general terms AND add this sentence exactly once at the end:
    "Double-check this with Temple Academic Advising."

If the question is about campus life, directions, walking distances, routines, feelings, or general advice:
  - Just answer normally. DO NOT mention Temple Academic Advising.

Avoid hallucinations.
Keep answers under 150 words.
Respond in a single friendly paragraph directly to the student, not as a dialogue.
`.trim();

let fullPrompt = `
${systemPrompt}

Student question: ${message}

Answer as CherryGuide in one concise reply.
`.trim();


    // 5. Call Bedrock Nova 2 Lite
    // NOTE: originally called amazon.titan-text-lite-v1, which AWS has
    // since fully retired from the Bedrock catalog. Migrated to Nova 2
    // Lite - same ultra-low-cost tier, current generation as of this
    // writing. Nova's request/response shape differs structurally from
    // Titan's: a messages array instead of a single inputText string,
    // and a native system field instead of concatenating instructions
    // into the prompt manually.
    const client = new BedrockRuntimeClient({ region: "us-east-1" });

    const command = new InvokeModelCommand({
      modelId: "us.amazon.nova-2-lite-v1:0",
      accept: "application/json",
      contentType: "application/json",
      body: JSON.stringify({
        messages: [
          { role: "user", content: [{ text: `Student question: ${message}\n\nAnswer as CherryGuide in one concise reply.` }] }
        ],
        system: [{ text: systemPrompt }],
        inferenceConfig: {
          maxTokens: 300,
          temperature: 0.6
        }
      })
    });

    const response = await client.send(command);
    const output = JSON.parse(new TextDecoder().decode(response.body));

    // 6. Return AI response
    let reply = output.output?.message?.content?.[0]?.text || "I'm here to help!";

    return formatres(res, { advisor: reply }, 200);

  } catch (err) {
    console.error("Advisor Error:", err);
    return formatres(res, { error: err.message }, 500);
  }
};

// ===============================
// BUDGET CALCULATOR (SAFE, PURE LOGIC)
// ===============================
let toolBudget = async (res, body) => {
  try {
    // 1. Validate token
    let userid = await validateTokenBasic(body.token);
    if (!userid) {
      return formatres(res, { error: "Invalid or missing token." }, 400);
    }

    // 2. Parse values - Support both front-end field names and original names
    //    Front-end sends: rent, food, books, income
    //    Original design: housing, food, transport, tuition, misc, incomeMonthly
    let income = parseFloat(body.income || body.incomeMonthly) || 0;
    let rent = parseFloat(body.rent || body.housing) || 0;
    let food = parseFloat(body.food) || 0;
    let books = parseFloat(body.books) || 0;
    
    // Also support legacy fields if provided
    let transport = parseFloat(body.transport) || 0;
    let tuition = parseFloat(body.tuition) || 0;
    let misc = parseFloat(body.misc) || 0;

    // 3. Totals - include all expense categories
    let totalExpenses = rent + food + books + transport + tuition + misc;
    let remaining = income - totalExpenses;
    let remainingWeekly = remaining / 4;

    let pct = (v) => income > 0 ? Math.round((v / income) * 100) : 0;

    let status = remaining >= 0 ? "good" : "over";

    // 4. Build AI-friendly result
    let result = {
      tool: "budget",
      userid: userid,
      
      // Echo back the input values (using front-end field names)
      income: income,
      rent: rent,
      food: food,
      books: books,
      
      // Calculated values
      totalExpenses: totalExpenses,
      remaining: remaining,
      remainingWeekly: Number(remainingWeekly.toFixed(2)),
      
      categoryPercentages: {
        rent: pct(rent),
        food: pct(food),
        books: pct(books),
        transport: pct(transport),
        tuition: pct(tuition),
        misc: pct(misc)
      },
      status: status,
      summary:
        status === "good"
          ? `You have $${remaining.toFixed(2)} left per month after expenses.`
          : `You are over budget by $${Math.abs(remaining).toFixed(2)}.`,

      // structured context for AI
      context: {
        type: "budget_analysis",
        income: income,
        expenses: totalExpenses,
        remainder: remaining,
        status: status
      }
    };

    return formatres(res, result, 200);

  } catch (err) {
    console.error("Budget tool error:", err);
    return formatres(res, { error: err.message }, 500);
  }
};




// do not delete this handy little supporting function
let formatres = async (res, output, statusCode) => {
	
	// kill the global database connection
	if (connection != undefined &&  
		typeof(connection)=='object' &&  
		typeof(connection.end())=='object'  ){
		await connection.end();
	}

	res.statusCode = statusCode;
	res.body = JSON.stringify(output);
	return res;	
}

// do not delete this handy little supportng function
function isEmpty(obj) {
    return Object.keys(obj).length === 0;
}

// My Routing Function ****** STUDENT MAY EDIT **********
let myRoutingFunction = async (res,method,path,query,body) => {

	if (method == "POST" && path == "login"){
        return postLogin(res,body);
    }

	if (method == "GET" && path == "debugusers"){
        if (!(await requireAdmin(query))) {
            return formatres(res, "Forbidden: admin access required.", 403);
        }
        return getUsers(res, features, 200);
    }

    if (method == "GET" && path == "debuglogins"){
        if (!(await requireAdmin(query))) {
            return formatres(res, "Forbidden: admin access required.", 403);
        }
        return getLogins(res,query);
    }

    if (method == "GET" && path == "debuggames"){
        if (!(await requireAdmin(query))) {
            return formatres(res, "Forbidden: admin access required.", 403);
        }
        return getGames(res,query);
    }

    if (method == "GET" && path == "debuggameprogress"){
        if (!(await requireAdmin(query))) {
            return formatres(res, "Forbidden: admin access required.", 403);
        }
        return getGameProgress(res,query);
    }

    if (method == "GET" && path == "debugleaderboard"){
        if (!(await requireAdmin(query))) {
            return formatres(res, "Forbidden: admin access required.", 403);
        }
        return getLeaderboard(res,query);
    }
    if (method == "POST" && path == "signup") {
    return signup(res, body);
}

	if (method == "GET" && path == ""){
		return formatres(res, features, 200);
	}

	if (method == "GET" && path == "datetime"){
		return theDatetimeFunction(res,query);
	}

	if (method == "GET" && path == "myname"){
		return myName(res,query);
	}

 if (method == "POST" && path == "startgame") {
  return startGame(res, body);
}

if (method == "PATCH" && path == "guess1") {
  return guess1(res, body);
}
if (method == "PATCH" && path == "guess2") {
  return guess2(res, body);
}
if (method == "PATCH" && path == "guess3") {
  return guess3(res, body);
}

if (method == "POST" && path == "endgame") {
  return endgame(res, body);
}
if (method == "DELETE" && path == "cancelgame") {
  return cancelGame(res, body);
}
if (method == "GET" && path == "leaderboard") {
  return getLeaderboardTop5(res, query);
}
if (method == "POST" && path == "gpa") {
  return toolGpa(res, body);
}

if (method == "POST" && path == "budget") {
  return toolBudget(res, body);
}

if (method == "POST" && path == "advisor") {
  return advisorHandler(res, body);
}

	return(res);
}

// event handler **** DO NOT EDIT ***********

// Students should not have to change the code here.
// Students should be able to read and understand the code here.

export const handler = async (request) => {

	connection = await mysql.createConnection(dboptions);	

	// identify the method (it will be a string)
	let method = request["httpMethod"];
	
	// identify the path (it will also be a string)
	let fullpath = request["path"];
	
	// we clean the full path up a little bit
	if (fullpath == undefined || fullpath == null){ fullpath = ""};
	let pathitems = fullpath.split("/");
	let path = pathitems[2];
	if (path == undefined || path == null){ path = ""};
	
	// identify the querystring ( we will convert it to 
	//   a JSON object named query)
	let query = request["queryStringParameters"];
	if (query == undefined || query == null){ query={} };
	
	// identify the body (we will convert it to 
	//   a JSON object named body)
	let body = qs.parse(request["body"]);
	if (body == undefined || body == null){ body={} };

	// Create the default response object that will include 
	// the status code, the headers needed by CORS, and
	// the string to be returned formatted as a JSON data structure.
    let res = {
        'statusCode': 400,
        'headers': {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Credentials': true  
        },
        'body': JSON.stringify("Feature not found."),
    };

	// run all the parameters through my routing function
	// and return the result
    return myRoutingFunction(res,method,path,query,body);
    
    //*** this is a good place to test one supporting function at a time
    //query={};
    //return theDatetimeFunction(res,query);
    
};
