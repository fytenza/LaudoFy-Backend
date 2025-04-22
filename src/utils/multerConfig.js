const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(), // Armazena o arquivo na memória como Buffer
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos PDF são permitidos'), false);
    }
  }
});

module.exports = upload;
