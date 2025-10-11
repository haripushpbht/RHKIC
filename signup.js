// signup.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, deleteUser, signOut, signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-database.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";

// ---------------- FIREBASE CONFIG ----------------
const firebaseConfig = {
  apiKey: "AIzaSyCIjL0gWAAe-kd1jcbqZeWqSbHj4Yi9jDI",
  authDomain: "rhkic-bandiya.firebaseapp.com",
  databaseURL: "https://rhkic-bandiya-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "rhkic-bandiya",
  storageBucket: "rhkic-bandiya.firebasestorage.app",
  messagingSenderId: "1050448660999",
  appId: "1:1050448660999:web:111aade54c5392df6a78a2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const firestore = getFirestore(app);

// expose core objects to window so other pages can reuse
window.firebaseApp = app;
window.auth = auth;
window.db = db;
window.firestore = firestore;

// ---------------- SIGNIN ----------------
window.signin = async function() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!email || !password) { alert('Please enter email and password to sign in.'); return; }
  try {
    logToConsole(`Signin attempt: ${email}`);
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const uid = userCred.user.uid;
    logToConsole(`Signin successful: ${email} (uid: ${uid})`);
    // read role from Realtime DB
    try {
      const roleSnap = await get(ref(db, 'users/' + uid + '/role'));
      if (!roleSnap.exists()) { alert('Logged in but role not found.'); return; }
      const role = roleSnap.val();
      if (role === 'student') window.location.href = 'student.html';
      else if (role === 'teacher') window.location.href = 'teacher.html';
      else if (role === 'operator') window.location.href = 'operator.html';
      else window.location.href = 'admin.html';
    } catch (e) {
      console.error(e);
      alert('Signed in but failed to determine role.');
    }
  } catch (e) {
    console.error(e);
    alert('Signin failed: ' + (e && e.message ? e.message : e));
  }
};

// ---------------- PASSWORD RECOVERY ----------------
window.recoverPassword = async function() {
  const email = document.getElementById('email').value.trim();
  if (!email) { alert('Enter your email address and click Forgot password to receive a reset link.'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    alert('Password reset email sent. Check your inbox.');
  } catch (e) {
    console.error(e);
    alert('Failed to send password reset email: ' + (e && e.message ? e.message : e));
  }
};

// ---------------- NAVIGATION ----------------
window.goHome = function() {
  window.location.href = 'index.html';
};

// ---------------- LOGGING (console only) ----------------
function logToConsole(message, level = 'info') {
  const ts = new Date().toLocaleTimeString();
  if (level === 'error') console.error(`[${ts}] ${message}`);
  else console.log(`[${ts}] ${message}`);
}

// ---------------- ROLE PIN VALIDATION ----------------
async function validateRolePin(role, enteredPin) {
  if (role === 'student') return true; // No PIN for students
  const normalizedRole = role.trim().toLowerCase();

  // Try Firestore doc rolePins/<role>
  try{
    const docRef = collection(firestore, 'rolePins');
    const snapshot = await getDocs(docRef);
    for(const docSnap of snapshot.docs){
      const docId = String(docSnap.id).trim().toLowerCase();
      if(docId === normalizedRole){
        const data = docSnap.data();
        const expectedPin = String(data.pin || '').trim();
        if(expectedPin === String(enteredPin).trim()) return true;
        throw new Error('Incorrect Role PIN!');
      }
    }
  }catch(e){
    console.warn('validateRolePin: Firestore check failed or not found, will try Realtime DB', e);
  }

  // Fallback to Realtime Database at rolePins/<role>
  try{
    const snap = await get(ref(db, 'rolePins/' + role));
    if(snap.exists()){
      const expectedPin = String(snap.val().pin || '').trim();
      if(expectedPin === String(enteredPin).trim()) return true;
      throw new Error('Incorrect Role PIN!');
    }
  }catch(e){
    console.warn('validateRolePin: Realtime DB check failed', e);
  }

  throw new Error(`Role PIN for '${role}' not found or incorrect.`);
}

// ---------------- TOGGLE PIN FIELD ----------------
window.togglePinField = function() {
  const role = document.getElementById("role").value;
  // show PIN input for teacher/admin/operator
  document.getElementById("pinBox").style.display = (role === "teacher" || role === "admin" || role === "operator") ? "block" : "none";
  // show student specific fields only for student role
  const studentFields = document.getElementById('studentFields');
  if(studentFields) studentFields.style.display = (role === 'student') ? 'block' : 'none';
};

// ---------------- SIGNUP FUNCTION ----------------
window.signup = async function() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const role = document.getElementById("role").value.trim();
  const pin = document.getElementById("pin").value.trim();

  if (!email || !password || !role) {
    alert("Please fill all fields!");
    return;
  }

  try {
    logToConsole(`Signup attempt: ${email} as ${role}`);

    // Create user in Firebase Auth first (so we can validate PIN as authenticated)
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCred.user;
    const uid = user.uid;

    // If role requires a PIN, validate it now while authenticated.
    if(role !== 'student'){
      try{
        await validateRolePin(role, pin);
      }catch(pinErr){
        // PIN invalid: delete the newly created auth user to avoid orphan accounts
        try{ await deleteUser(user); }catch(e){
          console.warn('Failed to delete user after PIN failure', e);
          try{ await signOut(auth); }catch(_){ }
        }
        throw pinErr;
      }
    }

    // Save user info in Realtime Database (include student details when applicable)
    const userRecord = { email, role, createdAt: new Date().toISOString() };
    // collect student fields if present in DOM
    try{
      const fullNameEl = document.getElementById('fullName');
      if(fullNameEl){
        const fullName = fullNameEl.value.trim();
        const fatherName = document.getElementById('fatherName').value.trim();
        const motherName = document.getElementById('motherName').value.trim();
        const studentClass = document.getElementById('studentClass').value.trim();
        const address = document.getElementById('address').value.trim();
        const mobile = document.getElementById('mobile').value.trim();
        const whatsapp = document.getElementById('whatsapp').value.trim();
        if(fullName) userRecord.student = { fullName, fatherName, motherName, class: studentClass, address, mobile, whatsapp };
      }
    }catch(e){ console.warn('collect student fields', e); }

    await set(ref(db, "users/" + uid), userRecord);

    logToConsole(`Signup successful for ${email} (uid: ${uid})`, 'success');
    alert("✅ Signup Successful as " + role);

    // Redirect based on role
    if(role === "student") window.location.href = "student.html";
    else if(role === "teacher") window.location.href = "teacher.html";
    else if(role === "operator") window.location.href = "operator.html";
    else window.location.href = "admin.html";

  } catch (error) {
    console.error(error);
    logToConsole(`Signup failed: ${error.message || error}`, 'error');
    alert("Signup Failed: " + (error.message || error));
  }
};
