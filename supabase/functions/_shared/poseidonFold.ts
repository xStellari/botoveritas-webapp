// supabase/functions/_shared/poseidonFold.ts
// Poseidon folding helper for BV_ZK_TALLY_WITNESS_UNIVERSAL_V1
//
// This MUST match zk/scripts/compute-results-hash.ts and the generated Circom
// circuit from zk/scripts/generate-tally-circuit.ts.

// circomlibjs has no bundled TS types. We keep typing strict by narrowing at runtime.
import * as circomlibjs from "circomlibjs";

type PoseidonFn = (inputs: bigint[]) => bigint;

let poseidonPromise: Promise<PoseidonFn> | null = null;

async function getPoseidon(): Promise<PoseidonFn> {
  if (!poseidonPromise) {
    poseidonPromise = (async () => {
      const buildPoseidon =
        (circomlibjs as unknown as { buildPoseidon?: () => Promise<unknown> }).buildPoseidon;

      if (typeof buildPoseidon !== "function") {
        throw new Error("circomlibjs.buildPoseidon not available");
      }

      const p = await buildPoseidon();

      // circomlibjs returns a function-like object; coerce safely.
      const fn = p as unknown as (inputs: unknown[]) => unknown;

      return (inputs: bigint[]) => {
        const out = fn(inputs) as unknown;

        // circomlibjs Poseidon output differs across runtimes:
        // - bigint (node)
        // - string/number
        // - Uint8Array (deno npm interop) -> comma-separated byte string if coerced
        return coerceToBigInt(out);
      };
    })();
  }
  return poseidonPromise;
}

export function toBigIntDec(x: string | number | bigint | boolean): bigint {
  if (typeof x === "bigint") return x;
  if (typeof x === "number") return BigInt(x);
  if (typeof x === "boolean") return x ? 1n : 0n;
  const s = String(x).trim();
  if (s.startsWith("0x")) return BigInt(s);
  return BigInt(s);
}


function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < bytes.length; i++) {
    x |= BigInt(bytes[i]!) << (8n * BigInt(i));
  }
  return x;
}

function coerceToBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return toBigIntDec(v);
  if (typeof v === "boolean") return v ? 1n : 0n;

  // Deno/npm often returns field elements as bytes
  if (v instanceof Uint8Array) return bytesToBigIntLE(v);
  if (v instanceof ArrayBuffer) return bytesToBigIntLE(new Uint8Array(v));

  // Some libs return objects that stringify to decimal or hex
  if (v && typeof v === "object" && "toString" in (v as any)) {
    const s = String((v as any).toString()).trim();
    if (s) return toBigIntDec(s);
  }

  throw new Error(`Cannot coerce Poseidon output to bigint: ${Object.prototype.toString.call(v)}`);
}

/**
 * Poseidon fold (BV_TALLY_UNIVERSAL_V1):
 *   h0 = Poseidon(domain, electionIdHash)
 *   h1 = Poseidon(h0, electionVoteRoot)
 *   h2 = Poseidon(h1, manifestHash)
 *   then for each x in foldVector: h = Poseidon(h, x)
 */
export async function computeResultsHashField(args: {
  domain: string | number | bigint | boolean;
  electionIdHashField: string | number | bigint | boolean;
  electionVoteRootField: string | number | bigint | boolean;
  manifestHashField: string | number | bigint | boolean;
  foldVector: Array<string | number | bigint | boolean>;
}): Promise<string> {
  const poseidon = await getPoseidon();

  const domain = toBigIntDec(args.domain);
  const electionIdHash = toBigIntDec(args.electionIdHashField);
  const root = toBigIntDec(args.electionVoteRootField);
  const manifestHash = toBigIntDec(args.manifestHashField);

  let h = poseidon([domain, electionIdHash]);
  h = poseidon([h, root]);
  h = poseidon([h, manifestHash]);

  for (const v of args.foldVector) {
    const x = toBigIntDec(v);
    h = poseidon([h, x]);
  }

  return h.toString(10);
}
