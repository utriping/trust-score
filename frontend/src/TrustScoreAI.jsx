import React, { useState, useEffect, useRef } from 'react';
import { Send, TrendingUp, AlertCircle, CheckCircle, DollarSign, MessageSquare, BarChart3, CreditCard, Calendar, Info, LogOut, User } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api';

const TrustScoreAI = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'signup'
  const [activeTab, setActiveTab] = useState('dashboard');
  
  // Auth form state
  const [authForm, setAuthForm] = useState({
    name: '',
    email: '',
    password: '',
    location: '',
    occupation: ''
  });

  // App state
  const [trustScoreData, setTrustScoreData] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [chatMessages, setChatMessages] = useState([
    { role: 'assistant', content: 'Hi! I\'m your TrustScore AI financial coach. How can I help you today?' }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const chatEndRef = useRef(null);

  useEffect(() => {
    // Check if user is already logged in
    const accessToken = localStorage.getItem('accessToken');
    const userData = localStorage.getItem('userData');
    if (accessToken && userData) {
      setIsAuthenticated(true);
      setCurrentUser(JSON.parse(userData));
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && currentUser) {
      fetchTrustScore();
      fetchTransactions();
    }
  }, [isAuthenticated, currentUser]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleAuthSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = authMode === 'login' ? '/login' : '/signup';
      const payload = authMode === 'login' 
        ? { email: authForm.email, password: authForm.password }
        : authForm;

      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      // Store tokens and user data
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('userData', JSON.stringify(data.user));

      setIsAuthenticated(true);
      setCurrentUser(data.user);
      setAuthForm({ name: '', email: '', password: '', location: '', occupation: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      await fetch(`${API_BASE_URL}/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
    } catch (err) {
      console.error('Logout error:', err);
    }

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userData');
    setIsAuthenticated(false);
    setCurrentUser(null);
    setTrustScoreData(null);
    setTransactions([]);
    setChatMessages([{ role: 'assistant', content: 'Hi! I\'m your TrustScore AI financial coach. How can I help you today?' }]);
  };

  const getAuthHeaders = () => {
    const token = localStorage.getItem('accessToken');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  const fetchTrustScore = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/trustscore/${currentUser.id}`, {
        headers: getAuthHeaders()
      });

      if (response.status === 401) {
        // Try to refresh token
        await refreshAccessToken();
        return fetchTrustScore();
      }

      const data = await response.json();
      if (response.ok) {
        setTrustScoreData(data);
      }
    } catch (error) {
      console.error('Error fetching trust score:', error);
    }
  };

  const fetchTransactions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/transactions/${currentUser.id}`);
      const data = await response.json();
      if (response.ok) {
        setTransactions(data.transactions || []);
      }
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const refreshAccessToken = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      const response = await fetch(`${API_BASE_URL}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('accessToken', data.accessToken);
      } else {
        handleLogout();
      }
    } catch (error) {
      console.error('Token refresh error:', error);
      handleLogout();
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMessage = { role: 'user', content: inputMessage };
    setChatMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ 
          question: inputMessage,
          userId: currentUser.id 
        })
      });

      if (response.status === 401) {
        await refreshAccessToken();
        return sendMessage();
      }

      const data = await response.json();
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: data.answer || data.error || 'Sorry, I could not process that.'
      }]);
    } catch (error) {
      console.error('Error sending message:', error);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 75) return 'text-green-600';
    if (score >= 50) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBgColor = (score) => {
    if (score >= 75) return 'bg-green-50 border-green-200';
    if (score >= 50) return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  // Auth Screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl p-3 inline-block mb-4">
              <TrendingUp className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              TrustScore AI
            </h1>
            <p className="text-gray-600 mt-2">Financial trust for gig workers</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setAuthMode('login')}
              className={`flex-1 py-2 rounded-lg font-semibold transition ${
                authMode === 'login'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Login
            </button>
            <button
              onClick={() => setAuthMode('signup')}
              className={`flex-1 py-2 rounded-lg font-semibold transition ${
                authMode === 'signup'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Sign Up
            </button>
          </div>

          <div className="space-y-4">
            {authMode === 'signup' && (
              <input
                type="text"
                placeholder="Full Name"
                value={authForm.name}
                onChange={(e) => setAuthForm({...authForm, name: e.target.value})}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            )}

            <input
              type="email"
              placeholder="Email"
              value={authForm.email}
              onChange={(e) => setAuthForm({...authForm, email: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={authForm.password}
              onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              required
            />

            {authMode === 'signup' && (
              <>
                <select
                  value={authForm.location}
                  onChange={(e) => setAuthForm({...authForm, location: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                >
                  <option value="">Select Location</option>
                  <option value="Mumbai">Mumbai</option>
                  <option value="Delhi">Delhi</option>
                  <option value="Bangalore">Bangalore</option>
                  <option value="Pune">Pune</option>
                </select>

                <select
                  value={authForm.occupation}
                  onChange={(e) => setAuthForm({...authForm, occupation: e.target.value})}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                >
                  <option value="">Select Occupation</option>
                  <option value="Food Stall Owner">Food Stall Owner</option>
                  <option value="Delivery Partner">Delivery Partner</option>
                  <option value="Electrician">Electrician</option>
                  <option value="Student">Student</option>
                </select>
              </>
            )}

            <button
              onClick={handleAuthSubmit}
              disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition disabled:opacity-50"
            >
              {loading ? 'Processing...' : authMode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard View
  const DashboardView = () => (
    <div className="space-y-6">
      {trustScoreData ? (
        <>
          {/* Trust Score Card */}
          <div className={`${getScoreBgColor(trustScoreData.trustScore)} border-2 rounded-xl p-6 shadow-lg`}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-800 mb-1">Your TrustScore</h2>
                <p className="text-sm text-gray-600">Based on {trustScoreData.totalTransactions} transactions</p>
              </div>
              <div className="bg-white rounded-full p-3">
                <TrendingUp className={`${getScoreColor(trustScoreData.trustScore)} w-6 h-6`} />
              </div>
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-6xl font-bold ${getScoreColor(trustScoreData.trustScore)}`}>
                {trustScoreData.trustScore}
              </span>
              <span className="text-2xl text-gray-500">/100</span>
            </div>
            <div className="mt-4 bg-white rounded-lg p-4">
              <p className="text-sm text-gray-700">{trustScoreData.insights}</p>
            </div>
          </div>

          {/* Income & Expense Stats */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Income</h3>
              <p className="text-3xl font-bold text-green-600">₹{trustScoreData.income?.monthly?.toFixed(0) || 0}</p>
              <p className="text-sm text-gray-600 mt-1">Monthly Average</p>
            </div>

            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Expenses</h3>
              <p className="text-3xl font-bold text-red-600">₹{trustScoreData.expenses?.monthly?.toFixed(0) || 0}</p>
              <p className="text-sm text-gray-600 mt-1">Monthly Average</p>
            </div>
          </div>

          {/* Loan Eligibility */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <DollarSign className="w-6 h-6 text-blue-600" />
              <h3 className="text-lg font-bold text-gray-800">Safe Loan Amount</h3>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">You can safely borrow</p>
              <p className="text-4xl font-bold text-blue-600">₹{trustScoreData.safeLoan?.toFixed(0) || 0}</p>
              <p className="text-xs text-gray-500 mt-2">Based on your income and spending patterns</p>
            </div>
          </div>

          {/* Anomalies */}
          {trustScoreData.anomalies && trustScoreData.anomalies.length > 0 && (
            <div className="bg-yellow-50 border-2 border-yellow-200 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <AlertCircle className="w-6 h-6 text-yellow-600" />
                <h3 className="text-lg font-bold text-gray-800">Unusual Transactions</h3>
              </div>
              <div className="space-y-2">
                {trustScoreData.anomalies.map((anomaly, idx) => (
                  <div key={idx} className="bg-white rounded-lg p-3">
                    <p className="font-semibold text-gray-800">₹{anomaly.amount?.toFixed(0)}</p>
                    <p className="text-sm text-gray-600">{anomaly.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-xl shadow-lg p-12 text-center">
          <Info className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-800 mb-2">No Transaction Data</h3>
          <p className="text-gray-600">Add transactions to see your TrustScore and insights</p>
        </div>
      )}
    </div>
  );

  // Transactions View
  const TransactionsView = () => (
    <div className="bg-white rounded-xl shadow-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <BarChart3 className="w-6 h-6 text-purple-600" />
        <h2 className="text-xl font-bold text-gray-800">Transaction History</h2>
      </div>
      {transactions.length > 0 ? (
        <div className="space-y-3">
          {transactions.map(txn => (
            <div key={txn.id} className="flex justify-between items-center p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  txn.type === 'credit' ? 'bg-green-100' : 'bg-red-100'
                }`}>
                  {txn.type === 'credit' ? (
                    <TrendingUp className="w-5 h-5 text-green-600" />
                  ) : (
                    <CreditCard className="w-5 h-5 text-red-600" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-800">{txn.description || txn.details || 'Transaction'}</p>
                  <p className="text-xs text-gray-500 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {txn.date} {txn.time}
                  </p>
                </div>
              </div>
              <span className={`text-lg font-bold ${
                txn.type === 'credit' ? 'text-green-600' : 'text-red-600'
              }`}>
                {txn.type === 'credit' ? '+' : '-'}₹{Math.abs(txn.amount)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <BarChart3 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-600">No transactions found</p>
        </div>
      )}
    </div>
  );

  // Chat View
  const ChatView = () => (
    <div className="bg-white rounded-xl shadow-lg flex flex-col h-[600px]">
      <div className="flex items-center gap-3 p-4 border-b">
        <MessageSquare className="w-6 h-6 text-indigo-600" />
        <h2 className="text-xl font-bold text-gray-800">AI Financial Coach</h2>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white' 
                : 'bg-gray-100 text-gray-800'
            }`}>
              <p className="text-sm">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-4 border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Ask: 'How much can I borrow?' or 'What's my trust score?'"
            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={sendMessage}
            disabled={loading}
            className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition disabled:opacity-50"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <header className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl p-2">
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                  TrustScore AI
                </h1>
                <p className="text-sm text-gray-600">Financial trust for everyone</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Welcome back</p>
                <p className="font-semibold text-gray-800">{currentUser?.name || currentUser?.email}</p>
                <p className="text-xs text-gray-500">{currentUser?.location} • {currentUser?.occupation}</p>
              </div>
              <button
                onClick={handleLogout}
                className="bg-red-50 text-red-600 p-2 rounded-lg hover:bg-red-100 transition"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <div className="max-w-7xl mx-auto px-4 mt-6">
        <div className="flex gap-2 bg-white rounded-xl p-2 shadow-md">
          {[
            { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
            { id: 'transactions', label: 'Transactions', icon: BarChart3 },
            { id: 'chat', label: 'AI Coach', icon: MessageSquare }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold transition ${
                activeTab === tab.id
                  ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'transactions' && <TransactionsView />}
        {activeTab === 'chat' && <ChatView />}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 py-6 text-center">
          <p className="text-sm text-gray-600">
            TrustScore AI - Enabling financial inclusion for gig workers and the unbanked
          </p>
          <p className="text-xs text-gray-500 mt-1">Mumbai Hacks 2025 Project</p>
        </div>
      </footer>
    </div>
  );
};

export default TrustScoreAI;