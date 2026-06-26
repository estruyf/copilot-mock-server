import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import forge from "node-forge";

const CA_DIR = path.join(os.homedir(), ".copilot-mock-server");
const CA_CERT_PATH = path.join(CA_DIR, "ca.crt");
const CA_KEY_PATH = path.join(CA_DIR, "ca.key");

interface CertPem {
  cert: string;
  key: string;
}

interface CAState {
  forgeCert: forge.pki.Certificate;
  forgeKey: forge.pki.rsa.PrivateKey;
}

interface LeafKeyState {
  forgePub: forge.pki.rsa.PublicKey;
  forgePriv: forge.pki.rsa.PrivateKey;
  privPem: string;
}

let caState: CAState | null = null;
let leafKeyState: LeafKeyState | null = null;
const hostCertCache = new Map<string, CertPem>();

function generateKeyPair(): LeafKeyState {
  const { privateKey: privPem, publicKey: pubPem } = crypto.generateKeyPairSync(
    "rsa",
    {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    },
  );
  return {
    forgePub: forge.pki.publicKeyFromPem(pubPem) as forge.pki.rsa.PublicKey,
    forgePriv: forge.pki.privateKeyFromPem(privPem) as forge.pki.rsa.PrivateKey,
    privPem,
  };
}

function loadOrCreateCA(): CAState {
  if (caState) return caState;

  if (fs.existsSync(CA_CERT_PATH) && fs.existsSync(CA_KEY_PATH)) {
    caState = {
      forgeCert: forge.pki.certificateFromPem(
        fs.readFileSync(CA_CERT_PATH, "utf8"),
      ),
      forgeKey: forge.pki.privateKeyFromPem(
        fs.readFileSync(CA_KEY_PATH, "utf8"),
      ) as forge.pki.rsa.PrivateKey,
    };
    return caState;
  }

  const keys = generateKeyPair();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.forgePub;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const subject = [
    { name: "commonName", value: "Copilot Mock CA" },
    { name: "organizationName", value: "copilot-mock-server" },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: true, critical: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(keys.forgePriv, forge.md.sha256.create());

  fs.mkdirSync(CA_DIR, { recursive: true });
  fs.writeFileSync(CA_CERT_PATH, forge.pki.certificateToPem(cert), "utf8");
  fs.writeFileSync(CA_KEY_PATH, keys.privPem, "utf8");

  caState = { forgeCert: cert, forgeKey: keys.forgePriv };
  return caState;
}

function getLeafKey(): LeafKeyState {
  if (leafKeyState) return leafKeyState;
  leafKeyState = generateKeyPair();
  return leafKeyState;
}

export function initCerts(): void {
  loadOrCreateCA();
  getLeafKey();
}

export function caPath(): string {
  loadOrCreateCA();
  return CA_CERT_PATH;
}

export function certForHost(hostname: string): CertPem {
  const cached = hostCertCache.get(hostname);
  if (cached) return cached;

  const ca = loadOrCreateCA();
  const leafKey = getLeafKey();

  const cert = forge.pki.createCertificate();
  cert.publicKey = leafKey.forgePub;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 2);

  cert.setSubject([{ name: "commonName", value: hostname }]);
  cert.setIssuer(ca.forgeCert.subject.attributes);
  cert.setExtensions([
    { name: "subjectAltName", altNames: [{ type: 2, value: hostname }] },
  ]);
  cert.sign(ca.forgeKey, forge.md.sha256.create());

  const result: CertPem = {
    cert: forge.pki.certificateToPem(cert),
    key: leafKey.privPem,
  };
  hostCertCache.set(hostname, result);
  return result;
}
