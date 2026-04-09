const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RefreshToken = sequelize.define(
    'RefreshToken',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tokenHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        field: 'token_hash',
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'user_id',
      },
      familyId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'family_id',
      },
      expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'expires_at',
      },
      revokedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        field: 'revoked_at',
      },
    },
    {
      tableName: 'refresh_token',
      paranoid: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      indexes: [{ fields: ['user_id'] }, { fields: ['family_id'] }, { fields: ['token_hash'] }],
    }
  );

  RefreshToken.associate = (models) => {
    RefreshToken.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user',
      onDelete: 'CASCADE',
    });
  };

  return RefreshToken;
};
