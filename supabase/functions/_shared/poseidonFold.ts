// supabase/functions/_shared/poseidonFold.ts
// Poseidon folding helper for BV_ZK_TALLY_WITNESS_UNIVERSAL_V1
//
// This MUST match zk/scripts/compute-results-hash.ts and the generated Circom
// circuit from zk/scripts/generate-tally-circuit.ts.

import * as circomlibjs from "circomlibjs";

type PoseidonFactory = ((inputs: bigint[]) => unknown) & {
  F?: { toObject?: (value: unknown) => bigint | string | number };
};

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

      const p = (await buildPoseidon()) as PoseidonFactory;
      const fn = p as unknown as (inputs: unknown[]) => unknown;
      const field = p?.F;

      return (inputs: bigint[]) => {
        const out = fn(inputs) as unknown;

        // This must match the Node-side script path used by zk/scripts/compute-results-hash.ts:
        //   const poseidon = await buildPoseidon();
        //   const F = poseidon.F;
        //   const x = F.toObject(poseidon([a, b]));
        //
        // Using raw byte coercion here can drift from circomlibjs field semantics and cause
        // the circuit assertion on resultsHash to fail during fullProve.
        if (field && typeof field.toObject === "function") {
          return toBigIntDec(field.toObject(out) as bigint | string | number);
        }

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
  if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
  return BigInt(s);
}

function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let x = 0n;
  for (const b of bytes) {
    x = (x << 8n) | BigInt(b);
  }
  return x;
}

function coerceToBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") return toBigIntDec(v);
  if (typeof v === "boolean") return v ? 1n : 0n;

  if (v instanceof Uint8Array) return bytesToBigIntBE(v);
  if (v instanceof ArrayBuffer) return bytesToBigIntBE(new Uint8Array(v));

  if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
    return bytesToBigIntBE(Uint8Array.from(v as number[]));
  }

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
