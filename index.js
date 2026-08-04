module.exports = (req, res) => {
  res.status(200).json({
    message: 'EasyMedical Backend API',
    routes: [
      '/api/chat - chatbot endpoint',
      '/api/auth/epic/authorize - start OAuth',
      '/api/auth/epic/callback - OAuth callback'
    ]
  });
};
