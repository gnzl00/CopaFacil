const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 2;
const DEFAULT_DATA_FILE = path.join(__dirname, "data", "copafacil.json");

function isPermissionError(error) {
  return ["EACCES", "EPERM", "EROFS"].includes(error && error.code);
}

function assertWritableDataPath(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const probeFile = path.join(dir, `.write-test-${process.pid}`);
  fs.writeFileSync(probeFile, "ok", "utf8");
  fs.unlinkSync(probeFile);
}

function createJsonStore({ defaultData, normalizeData }) {
  const configuredDataFile = process.env.DATA_FILE || DEFAULT_DATA_FILE;
  let dataFile = configuredDataFile;

  function selectDataFile() {
    try {
      assertWritableDataPath(configuredDataFile);
      dataFile = configuredDataFile;
      return;
    } catch (error) {
      if (configuredDataFile === DEFAULT_DATA_FILE || !isPermissionError(error)) {
        throw error;
      }
      console.warn(
        `No se puede escribir en DATA_FILE=${configuredDataFile}. ` +
          `Usando almacenamiento temporal en ${DEFAULT_DATA_FILE}. ` +
          "En Render, monta un Persistent Disk en /var/data para conservar datos."
      );
    }

    assertWritableDataPath(DEFAULT_DATA_FILE);
    dataFile = DEFAULT_DATA_FILE;
  }

  function ensureDataFile() {
    const dir = path.dirname(dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(dataFile)) {
      writeJson(defaultData());
    }
  }

  async function init() {
    selectDataFile();
    ensureDataFile();
  }

  async function read() {
    ensureDataFile();
    const raw = fs.readFileSync(dataFile, "utf8");
    const normalized = normalizeData(JSON.parse(raw));
    if (normalized.changed) {
      return writeJson(normalized.data);
    }
    return normalized.data;
  }

  function writeJson(data) {
    const dir = path.dirname(dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const nextData = { ...data, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
    const tempFile = `${dataFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, `${JSON.stringify(nextData, null, 2)}\n`, "utf8");
    fs.renameSync(tempFile, dataFile);
    return nextData;
  }

  async function write(data) {
    return writeJson(data);
  }

  return {
    init,
    read,
    write,
    describe() {
      return `JSON (${dataFile})`;
    }
  };
}

function parseServiceAccountJson(value) {
  if (!value) {
    return null;
  }
  const account = JSON.parse(value);
  if (account.private_key) {
    account.private_key = account.private_key.replace(/\\n/g, "\n");
  }
  return account;
}

function parseFirebaseCredentials() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return parseServiceAccountJson(json);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, "\n")
    };
  }

  return null;
}

function loadFirebaseAdmin() {
  try {
    return require("firebase-admin");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error(
        "DATA_STORE=firestore requiere instalar la dependencia firebase-admin. Ejecuta npm install antes de desplegar."
      );
    }
    throw error;
  }
}

function createFirestoreStore({ defaultData, normalizeData }) {
  const collectionName = process.env.FIRESTORE_COLLECTION || "copaFacil";
  const documentId = process.env.FIRESTORE_DOCUMENT || "production";
  let docRef;

  async function init() {
    const admin = loadFirebaseAdmin();
    const serviceAccount = parseFirebaseCredentials();

    if (!serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error(
        "DATA_STORE=firestore requiere credenciales: FIREBASE_SERVICE_ACCOUNT_JSON o FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY."
      );
    }

    if (!admin.apps.length) {
      if (serviceAccount) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: serviceAccount.project_id || serviceAccount.projectId || process.env.FIREBASE_PROJECT_ID
        });
      } else {
        admin.initializeApp({
          projectId: process.env.FIREBASE_PROJECT_ID
        });
      }
    }

    docRef = admin.firestore().collection(collectionName).doc(documentId);
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      await write(defaultData());
    }
  }

  async function read() {
    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return write(defaultData());
    }
    const normalized = normalizeData(snapshot.data());
    if (normalized.changed) {
      return write(normalized.data);
    }
    return normalized.data;
  }

  async function write(data) {
    const nextData = { ...data, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() };
    await docRef.set(nextData);
    return nextData;
  }

  return {
    init,
    read,
    write,
    describe() {
      return `Firestore (${collectionName}/${documentId})`;
    }
  };
}

function normalizeStoreMode(value) {
  const mode = String(value || "json").trim().toLowerCase();
  if (mode === "firestore") {
    return "firestore";
  }
  return "json";
}

function createStore(options) {
  if (!options || typeof options.defaultData !== "function" || typeof options.normalizeData !== "function") {
    throw new Error("createStore requiere defaultData y normalizeData.");
  }

  const mode = normalizeStoreMode(process.env.DATA_STORE || process.env.STORAGE_DRIVER);
  if (mode === "firestore") {
    return createFirestoreStore(options);
  }
  return createJsonStore(options);
}

module.exports = { createStore };
