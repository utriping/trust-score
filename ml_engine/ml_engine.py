# ml_engine.py
# FastAPI microservice that analyzes transactions and uses location & occupation
# pip install fastapi uvicorn numpy pydantic

from fastapi import FastAPI
from pydantic import BaseModel
import numpy as np
import uvicorn
from dotenv import load_dotenv
import os 
load_dotenv()
app = FastAPI()
port = os.load("ML_PORT")

class TxData(BaseModel):
    amounts: list
    types: list
    descriptions: list = []
    timestamps: list = []
    location: str = ""
    occupation: str = ""

# simple location / occupation multipliers (extendable)
LOCATION_FACTOR = {
    "Mumbai": 0.75,
    "Delhi": 0.8,
    "Bangalore": 0.78,
    "Pune": 0.85
}
OCCUPATION_FACTOR = {
    "Food Stall Owner": 0.8,
    "Delivery Partner": 0.9,
    "Electrician": 0.85,
    "Student": 0.75
}

@app.post("/analyze")
async def analyze(data: TxData):
    # normalize amounts into numpy array
    try:
        amounts = np.array([float(x) for x in data.amounts]) if data.amounts else np.array([])
    except Exception:
        amounts = np.array([])

    # Pair types and amounts safely
    types = data.types or []
    pairs = list(zip(types, amounts)) if len(types) == len(amounts) else []
    income_vals = np.array([amt for typ, amt in pairs if typ == "credit"], dtype=float) if pairs else np.array([])
    expense_vals = np.array([amt for typ, amt in pairs if typ == "debit"], dtype=float) if pairs else np.array([])

    income_monthly = float(np.sum(income_vals)) if income_vals.size else 0.0
    expense_monthly = float(np.sum(expense_vals)) if expense_vals.size else 0.0

    income_avg = float(np.mean(income_vals)) if income_vals.size else 0.0
    expense_avg = float(np.mean(expense_vals)) if expense_vals.size else 0.0

    # anomaly detection: values > mean*3
    anomalies = []
    mean_all = float(np.mean(amounts)) if amounts.size else 0.0
    for amt in amounts:
        if mean_all > 0 and amt > mean_all * 3:
            anomalies.append({"amount": float(amt), "reason": "Unusually high transaction"})

    # basic trustscore baseline (out of 100)
    # Start with a simple heuristic:
    trustScore = 50
    # income stability bonus
    if income_avg > 0:
        stability = 1 - (np.std(income_vals) / (income_avg + 1e-9)) if income_vals.size else 0
        stability_score = max(0, min(30, stability * 30))
        trustScore += stability_score
    # expense discipline
    if income_monthly > 0:
        ratio = (income_monthly - expense_monthly) / (income_monthly + 1e-9)
        expense_score = max(-20, min(20, ratio * 20))
        trustScore += expense_score
    # anomaly penalty
    trustScore -= len(anomalies) * 5
    trustScore = int(max(5, min(100, trustScore)))

    # safe loan base = net monthly savings * 0.8
    base_safe = max(0.0, (income_monthly - expense_monthly) * 0.8)

    # Apply location & occupation multipliers
    loc_mul = LOCATION_FACTOR.get(data.location, 1.0)
    occ_mul = OCCUPATION_FACTOR.get(data.occupation, 1.0)

    safeLoan = float(base_safe * loc_mul * occ_mul)

    insights = []
    if income_monthly == 0:
        insights.append("No recorded income in provided transactions.")
    else:
        insights.append(f"Avg monthly income: ₹{round(income_monthly)}; avg monthly expenses: ₹{round(expense_monthly)}.")

    if anomalies:
        insights.append(f"Detected {len(anomalies)} unusual transaction(s).")

    insights.append(f"Adjusted for location ({data.location}) and occupation ({data.occupation}).")

    return {
        "trustScore": trustScore,
        "safeLoan": round(safeLoan, 2),
        "incomeStats": {"monthly": round(income_monthly, 2), "average": round(income_avg, 2)},
        "expenseStats": {"monthly": round(expense_monthly, 2), "average": round(expense_avg, 2)},
        "anomalies": anomalies,
        "insights": " ".join(insights)
    }

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=port)
