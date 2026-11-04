import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/**
 * electron-builder only signs with identities macOS trusts, and the shared self-signed one is not.
 * Squirrel accepts an update only when it meets the running app's designated requirement, which
 * pins this certificate, so every build is signed with it here, before the zip and dmg are made.
 */
const IDENTITY = "2FA2057FB218EEC7CBB6961B18455C35C470D7E2";

const LOCAL_KEYCHAIN = path.join(
  homedir(),
  "Library/Keychains/inset-signing.keychain-db"
);

const LOCAL_PASSWORD = path.join(
  homedir(),
  ".config/inset-signing/keychain-password"
);

const MACH_O_MAGIC = new Set([
  0xfe_ed_fa_ce, 0xce_fa_ed_fe, 0xfe_ed_fa_cf, 0xcf_fa_ed_fe, 0xca_fe_ba_be,
]);

const isMachO = async (file) => {
  const handle = await open(file);

  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0);

    return bytesRead === 4 && MACH_O_MAGIC.has(buffer.readUInt32BE(0));
  } finally {
    await handle.close();
  }
};

/** codesign --deep skips binaries under Resources, such as get-windows' helper in app.asar.unpacked. */
const looseBinaries = async (resources) => {
  const entries = await readdir(resources, {
    recursive: true,
    withFileTypes: true,
  });

  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));

  const machO = await Promise.all(files.map(isMachO));

  return files.filter((_file, index) => machO[index]);
};

const signingArgs = () => {
  const ciKeychain = process.env.INSET_SIGNING_KEYCHAIN;

  if (ciKeychain !== undefined) {
    return ["--keychain", ciKeychain, "--sign", IDENTITY];
  }

  if (!existsSync(LOCAL_KEYCHAIN)) {
    console.warn(
      "sign-mac: no signing keychain, so signing ad hoc. This build cannot update a signed install."
    );

    return ["--sign", "-"];
  }

  if (existsSync(LOCAL_PASSWORD)) {
    execFileSync("security", [
      "unlock-keychain",
      "-p",
      readFileSync(LOCAL_PASSWORD, "utf-8").trim(),
      LOCAL_KEYCHAIN,
    ]);
  }

  return ["--keychain", LOCAL_KEYCHAIN, "--sign", IDENTITY];
};

const codesign = (...args) =>
  execFileSync("codesign", args, { stdio: "inherit" });

export default async function signMac(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const app = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const sign = ["--force", "--timestamp=none", ...signingArgs()];
  const binaries = await looseBinaries(path.join(app, "Contents/Resources"));

  for (const binary of binaries) {
    codesign(...sign, binary);
  }

  codesign(...sign, "--deep", app);

  codesign("--verify", "--deep", "--strict", app);
}
