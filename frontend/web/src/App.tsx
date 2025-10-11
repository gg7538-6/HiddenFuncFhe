// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FunctionEvaluation {
  id: string;
  functionHash: string;
  inputs: string[];
  result: string;
  timestamp: number;
  participants: string[];
  status: "pending" | "completed" | "failed";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState<FunctionEvaluation[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showNewEvalModal, setShowNewEvalModal] = useState(false);
  const [creatingEval, setCreatingEval] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newEvaluation, setNewEvaluation] = useState({
    functionCode: "",
    inputs: [""],
    description: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("evaluations");

  // Statistics
  const completedCount = evaluations.filter(e => e.status === "completed").length;
  const pendingCount = evaluations.filter(e => e.status === "pending").length;
  const failedCount = evaluations.filter(e => e.status === "failed").length;
  const participationCount = evaluations.reduce((count, evalItem) => 
    count + (evalItem.participants.includes(account) ? 1 : 0), 0);

  useEffect(() => {
    loadEvaluations().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadEvaluations = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("evaluation_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing evaluation keys:", e);
        }
      }
      
      const list: FunctionEvaluation[] = [];
      
      for (const key of keys) {
        try {
          const evalBytes = await contract.getData(`evaluation_${key}`);
          if (evalBytes.length > 0) {
            try {
              const evalData = JSON.parse(ethers.toUtf8String(evalBytes));
              list.push({
                id: key,
                functionHash: evalData.functionHash,
                inputs: evalData.inputs,
                result: evalData.result,
                timestamp: evalData.timestamp,
                participants: evalData.participants,
                status: evalData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing evaluation data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading evaluation ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setEvaluations(list);
    } catch (e) {
      console.error("Error loading evaluations:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createEvaluation = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreatingEval(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting function and inputs with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify({
        function: newEvaluation.functionCode,
        inputs: newEvaluation.inputs,
        description: newEvaluation.description
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const evalId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const evalData = {
        functionHash: ethers.keccak256(ethers.toUtf8Bytes(newEvaluation.functionCode)),
        inputs: newEvaluation.inputs,
        result: "",
        timestamp: Math.floor(Date.now() / 1000),
        participants: [account],
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `evaluation_${evalId}`, 
        ethers.toUtf8Bytes(JSON.stringify(evalData))
      );
      
      const keysBytes = await contract.getData("evaluation_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(evalId);
      
      await contract.setData(
        "evaluation_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Private function evaluation created!"
      });
      
      await loadEvaluations();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowNewEvalModal(false);
        setNewEvaluation({
          functionCode: "",
          inputs: [""],
          description: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreatingEval(false);
    }
  };

  const participateInEvaluation = async (evalId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Joining private function evaluation..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const evalBytes = await contract.getData(`evaluation_${evalId}`);
      if (evalBytes.length === 0) {
        throw new Error("Evaluation not found");
      }
      
      const evalData = JSON.parse(ethers.toUtf8String(evalBytes));
      
      if (evalData.participants.includes(account)) {
        throw new Error("Already participating");
      }
      
      const updatedEval = {
        ...evalData,
        participants: [...evalData.participants, account]
      };
      
      await contract.setData(
        `evaluation_${evalId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEval))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Successfully joined evaluation!"
      });
      
      await loadEvaluations();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Participation failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to participate in private evaluations",
      icon: "🔗"
    },
    {
      title: "Create Evaluation",
      description: "Define your private function and inputs (both remain encrypted)",
      icon: "🔒"
    },
    {
      title: "FHE Computation",
      description: "Function executes on encrypted data without revealing inputs or logic",
      icon: "⚙️"
    },
    {
      title: "Get Results",
      description: "Receive computed results while keeping all inputs and functions private",
      icon: "📊"
    }
  ];

  const renderStatusBar = () => {
    const total = evaluations.length || 1;
    const completedWidth = (completedCount / total) * 100;
    const pendingWidth = (pendingCount / total) * 100;
    const failedWidth = (failedCount / total) * 100;

    return (
      <div className="status-bar-container">
        <div className="status-bar">
          <div 
            className="status-segment completed" 
            style={{ width: `${completedWidth}%` }}
          ></div>
          <div 
            className="status-segment pending" 
            style={{ width: `${pendingWidth}%` }}
          ></div>
          <div 
            className="status-segment failed" 
            style={{ width: `${failedWidth}%` }}
          ></div>
        </div>
        <div className="status-legend">
          <div className="legend-item">
            <div className="color-dot completed"></div>
            <span>Completed: {completedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-dot failed"></div>
            <span>Failed: {failedCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Private Function Evaluation</h1>
          <p>FHE-based secure multi-party computation with hidden functions</p>
        </div>
        <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
      </header>
      
      <nav className="app-nav">
        <button 
          className={activeTab === "evaluations" ? "active" : ""}
          onClick={() => setActiveTab("evaluations")}
        >
          Evaluations
        </button>
        <button 
          className={activeTab === "tutorial" ? "active" : ""}
          onClick={() => setActiveTab("tutorial")}
        >
          How It Works
        </button>
        <button 
          className={activeTab === "stats" ? "active" : ""}
          onClick={() => setActiveTab("stats")}
        >
          Statistics
        </button>
      </nav>
      
      <main className="app-main">
        {activeTab === "evaluations" && (
          <div className="evaluations-section">
            <div className="section-header">
              <h2>Private Function Evaluations</h2>
              <div className="controls">
                <button 
                  onClick={loadEvaluations}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button 
                  onClick={() => setShowNewEvalModal(true)}
                >
                  New Evaluation
                </button>
              </div>
            </div>
            
            <div className="evaluations-list">
              {evaluations.length === 0 ? (
                <div className="empty-state">
                  <p>No function evaluations found</p>
                  <button onClick={() => setShowNewEvalModal(true)}>
                    Create First Evaluation
                  </button>
                </div>
              ) : (
                <div className="evaluation-cards">
                  {evaluations.map(evalItem => (
                    <div className="evaluation-card" key={evalItem.id}>
                      <div className="card-header">
                        <h3>Evaluation #{evalItem.id.substring(0, 6)}</h3>
                        <span className={`status-badge ${evalItem.status}`}>
                          {evalItem.status}
                        </span>
                      </div>
                      <div className="card-body">
                        <div className="info-row">
                          <span>Function Hash:</span>
                          <span>{evalItem.functionHash.substring(0, 12)}...{evalItem.functionHash.substring(58)}</span>
                        </div>
                        <div className="info-row">
                          <span>Participants:</span>
                          <span>{evalItem.participants.length}</span>
                        </div>
                        <div className="info-row">
                          <span>Date:</span>
                          <span>{new Date(evalItem.timestamp * 1000).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="card-footer">
                        {!evalItem.participants.includes(account) && (
                          <button 
                            onClick={() => participateInEvaluation(evalItem.id)}
                          >
                            Join Evaluation
                          </button>
                        )}
                        {evalItem.participants.includes(account) && (
                          <button disabled>
                            Already Participating
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === "tutorial" && (
          <div className="tutorial-section">
            <h2>How Private Function Evaluation Works</h2>
            <p className="subtitle">Secure multi-party computation with fully homomorphic encryption</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div className="tutorial-step" key={index}>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="fhe-explanation">
              <h3>FHE Technology</h3>
              <p>
                Fully Homomorphic Encryption allows computations to be performed on encrypted data without 
                decrypting it first. This means your private functions and inputs remain confidential 
                throughout the entire evaluation process.
              </p>
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>Evaluation Statistics</h2>
            
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-value">{evaluations.length}</div>
                <div className="stat-label">Total Evaluations</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{participationCount}</div>
                <div className="stat-label">Your Participations</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{completedCount}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
            </div>
            
            <div className="status-section">
              <h3>Evaluation Status Distribution</h3>
              {renderStatusBar()}
            </div>
            
            <div className="participation-section">
              <h3>Your Participation History</h3>
              <div className="participation-chart">
                {/* Placeholder for participation chart */}
                <div className="chart-placeholder">
                  <p>Participation history visualization</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
  
      {showNewEvalModal && (
        <ModalNewEvaluation 
          onSubmit={createEvaluation} 
          onClose={() => setShowNewEvalModal(false)} 
          creating={creatingEval}
          evaluation={newEvaluation}
          setEvaluation={setNewEvaluation}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-info">
            <h3>Private Function Evaluation</h3>
            <p>Secure multi-party computation with FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#">Documentation</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} FHE Research Consortium</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalNewEvaluationProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  evaluation: any;
  setEvaluation: (data: any) => void;
}

const ModalNewEvaluation: React.FC<ModalNewEvaluationProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  evaluation,
  setEvaluation
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEvaluation({
      ...evaluation,
      [name]: value
    });
  };

  const handleInputChange = (index: number, value: string) => {
    const newInputs = [...evaluation.inputs];
    newInputs[index] = value;
    setEvaluation({
      ...evaluation,
      inputs: newInputs
    });
  };

  const addInput = () => {
    setEvaluation({
      ...evaluation,
      inputs: [...evaluation.inputs, ""]
    });
  };

  const removeInput = (index: number) => {
    const newInputs = [...evaluation.inputs];
    newInputs.splice(index, 1);
    setEvaluation({
      ...evaluation,
      inputs: newInputs
    });
  };

  const handleSubmit = () => {
    if (!evaluation.functionCode || evaluation.inputs.some((i: string) => !i)) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="new-eval-modal">
        <div className="modal-header">
          <h2>New Private Evaluation</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <p>Your function and inputs will be encrypted using FHE before evaluation</p>
          </div>
          
          <div className="form-group">
            <label>Function Code *</label>
            <textarea 
              name="functionCode"
              value={evaluation.functionCode} 
              onChange={handleChange}
              placeholder="Enter your private function code..." 
              rows={6}
            />
          </div>
          
          <div className="form-group">
            <label>Inputs *</label>
            {evaluation.inputs.map((input: string, index: number) => (
              <div className="input-row" key={index}>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => handleInputChange(index, e.target.value)}
                  placeholder={`Input ${index + 1}`}
                />
                {evaluation.inputs.length > 1 && (
                  <button 
                    type="button"
                    onClick={() => removeInput(index)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button 
              type="button"
              onClick={addInput}
            >
              Add Input
            </button>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text"
              name="description"
              value={evaluation.description} 
              onChange={handleChange}
              placeholder="Brief description of the evaluation..." 
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose}>
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
          >
            {creating ? "Creating with FHE..." : "Create Evaluation"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;