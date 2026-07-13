import time
import uuid
import random
import json
from pathlib import Path

# Areté Infrastructure Benchmark Harness
# Simulates massive telemetry ingestion loads and malicious traffic to compare
# Baseline API handling vs. Superlog-optimized infrastructure.

def generate_webhooks(count=50):
    hooks = []
    for _ in range(count):
        is_poison = random.random() < 0.2  # 20% of traffic is malicious/empty
        payload_size_mb = random.uniform(0.1, 50.0)
        hooks.append({
            "id": str(uuid.uuid4()),
            "is_poison": is_poison,
            "size_mb": payload_size_mb,
            "spans_generated": random.randint(100, 1000)
        })
    return hooks

def simulate_baseline_infra(webhooks):
    # Baseline:
    # 1. Processes every poison message through full auth/DB validation before failing.
    # 2. Holds all payloads (even 50MB) in memory buffers, leading to GC pauses.
    # 3. Fires an individual API request for EVERY single telemetry span.
    
    total_time_ms = 0
    total_api_calls = 0
    oom_risk = 0.0

    for hook in webhooks:
        # Poison handling cost (DB hit + LLM rejection)
        if hook["is_poison"]:
            total_time_ms += 150 
        else:
            # Memory ingestion cost (no dual-lanes)
            total_time_ms += hook["size_mb"] * 10 
            oom_risk += hook["size_mb"]
            
            # Telemetry spans (no micro-batching)
            total_api_calls += hook["spans_generated"]
            total_time_ms += hook["spans_generated"] * 2 # 2ms per HTTP request
            
    return {
        "strategy": "baseline",
        "total_processing_ms": total_time_ms,
        "api_requests_fired": total_api_calls,
        "peak_memory_mb": oom_risk
    }

def simulate_advanced_infra(webhooks):
    # Superlog-Optimized:
    # 1. Pre-Auth Poison Guard drops empty/malformed immediately (1ms).
    # 2. Dual-Lane Queuing streams >5MB payloads directly to S3 (constant memory).
    # 3. Producer-side Micro-Batching aggregates spans into chunks of 100.
    
    total_time_ms = 0
    total_api_calls = 0
    peak_memory_mb = 0.0

    for hook in webhooks:
        if hook["is_poison"]:
            total_time_ms += 1 # Fast pre-auth rejection
        else:
            if hook["size_mb"] > 5.0:
                # Upload lane (streamed, low memory footprint)
                total_time_ms += hook["size_mb"] * 2 
                peak_memory_mb = max(peak_memory_mb, 5.0) # bounded
            else:
                # Buffer lane
                total_time_ms += hook["size_mb"] * 5
                peak_memory_mb = max(peak_memory_mb, hook["size_mb"])
                
            # Micro-batched telemetry
            batches = (hook["spans_generated"] // 100) + 1
            total_api_calls += batches
            total_time_ms += batches * 5 # 5ms per batched HTTP request
            
    return {
        "strategy": "advanced_infra",
        "total_processing_ms": total_time_ms,
        "api_requests_fired": total_api_calls,
        "peak_memory_mb": peak_memory_mb
    }

def run_benchmarks():
    print("Generating 50 synthetic webhooks...")
    webhooks = generate_webhooks(50)
    
    base_res = simulate_baseline_infra(webhooks)
    adv_res = simulate_advanced_infra(webhooks)
    
    out_path = Path("infra_benchmark_results.json")
    out_path.write_text(json.dumps({"baseline": base_res, "advanced": adv_res}, indent=2))
    print(f"Saved infrastructure metrics to {out_path.absolute()}")

if __name__ == "__main__":
    run_benchmarks()
