// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HiddenFuncFHE is SepoliaConfig {
    struct EncryptedFunction {
        uint256 functionId;
        euint32 encryptedCode;        // Encrypted function code
        euint32 encryptedParameters;  // Encrypted function parameters
        uint256 timestamp;
    }
    
    struct ComputationSession {
        uint256[] participantIds;
        euint32 encryptedInputs;      // Encrypted inputs from participants
        euint32 encryptedOutput;      // Encrypted computation result
        bool isCompleted;
    }

    uint256 public functionCount;
    uint256 public sessionCount;
    mapping(uint256 => EncryptedFunction) public encryptedFunctions;
    mapping(uint256 => ComputationSession) public computationSessions;
    
    mapping(uint256 => uint256) private requestToSessionId;
    mapping(address => bool) private authorizedParties;
    
    event FunctionRegistered(uint256 indexed functionId, uint256 timestamp);
    event SessionCreated(uint256 indexed sessionId, uint256[] participantIds);
    event ComputationRequested(uint256 indexed sessionId);
    event ComputationCompleted(uint256 indexed sessionId);
    
    modifier onlyAuthorized() {
        require(authorizedParties[msg.sender], "Unauthorized");
        _;
    }
    
    constructor() {
        authorizedParties[msg.sender] = true;
    }
    
    function authorizeParty(address party) public onlyAuthorized {
        authorizedParties[party] = true;
    }
    
    function registerEncryptedFunction(
        euint32 encryptedCode,
        euint32 encryptedParameters
    ) public onlyAuthorized {
        functionCount += 1;
        uint256 newId = functionCount;
        
        encryptedFunctions[newId] = EncryptedFunction({
            functionId: newId,
            encryptedCode: encryptedCode,
            encryptedParameters: encryptedParameters,
            timestamp: block.timestamp
        });
        
        emit FunctionRegistered(newId, block.timestamp);
    }
    
    function createComputationSession(
        uint256[] memory participantIds,
        euint32 encryptedInputs
    ) public onlyAuthorized {
        sessionCount += 1;
        uint256 newId = sessionCount;
        
        computationSessions[newId] = ComputationSession({
            participantIds: participantIds,
            encryptedInputs: encryptedInputs,
            encryptedOutput: FHE.asEuint32(0),
            isCompleted: false
        });
        
        emit SessionCreated(newId, participantIds);
    }
    
    function requestComputation(
        uint256 sessionId,
        uint256 functionId
    ) public onlyAuthorized {
        ComputationSession storage session = computationSessions[sessionId];
        require(!session.isCompleted, "Session already completed");
        
        EncryptedFunction storage func = encryptedFunctions[functionId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(session.encryptedInputs);
        ciphertexts[1] = FHE.toBytes32(func.encryptedCode);
        ciphertexts[2] = FHE.toBytes32(func.encryptedParameters);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.executeComputation.selector);
        requestToSessionId[reqId] = sessionId;
        
        emit ComputationRequested(sessionId);
    }
    
    function executeComputation(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 sessionId = requestToSessionId[requestId];
        require(sessionId != 0, "Invalid request");
        
        ComputationSession storage session = computationSessions[sessionId];
        require(!session.isCompleted, "Session already completed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        uint32 inputs = results[0];
        uint32 functionCode = results[1];
        uint32 parameters = results[2];
        
        // Apply hidden function to inputs (simplified example)
        uint32 output = applyHiddenFunction(inputs, functionCode, parameters);
        
        // Re-encrypt the output
        session.encryptedOutput = FHE.asEuint32(output);
        session.isCompleted = true;
        
        emit ComputationCompleted(sessionId);
    }
    
    function getEncryptedResult(uint256 sessionId) public view returns (euint32) {
        require(computationSessions[sessionId].isCompleted, "Computation not completed");
        return computationSessions[sessionId].encryptedOutput;
    }
    
    function requestResultDecryption(uint256 sessionId) public onlyAuthorized {
        ComputationSession storage session = computationSessions[sessionId];
        require(session.isCompleted, "Computation not completed");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(session.encryptedOutput);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptResult.selector);
        requestToSessionId[reqId] = sessionId;
    }
    
    function decryptResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public onlyAuthorized {
        uint256 sessionId = requestToSessionId[requestId];
        require(sessionId != 0, "Invalid request");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        uint32 result = abi.decode(cleartexts, (uint32));
        
        // Handle decrypted result as needed
    }
    
    // Helper function to apply hidden functions (simplified example)
    function applyHiddenFunction(uint32 inputs, uint32 functionCode, uint32 parameters) private pure returns (uint32) {
        if (functionCode == 1) {
            return inputs + parameters;  // Addition
        } else if (functionCode == 2) {
            return inputs * parameters;   // Multiplication
        } else if (functionCode == 3) {
            return inputs ^ parameters;   // XOR
        } else {
            return inputs;               // Identity function
        }
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
}